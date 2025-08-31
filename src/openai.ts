import { GitConfig } from './types';
import { ChangeItem, TopicGroup } from './types';

export function loadConfig(): GitConfig {
  const openAIKey = 
    process.env.COMMITTY_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  
  const openAIBaseUrl = 
    process.env.COMMITTY_OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com/v1';

  if (!openAIKey) {
    throw new Error(
      'Missing OpenAI API key. Set COMMITTY_OPENAI_API_KEY or OPENAI_API_KEY in your environment.'
    );
  }

  return { openAIKey, openAIBaseUrl };
}

export function openaiUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, '') + path;
}

export interface OpenAIOptions {
  model?: string;
  temperature?: number;
  response_format?: { type: string };
}

export async function openaiChat(
  config: GitConfig,
  messages: { role: string; content: string }[],
  options?: OpenAIOptions
): Promise<string> {
  const model = options?.model || 'gpt-4o-mini';
  let temperature = options?.temperature ?? 0.2;
  let extraOptions = {max_tokens: 1500, max_completion_tokens: 4000};
  if (['gpt-5', 'gpt-5-mini', 'o4-mini'].includes(model)) {
    temperature = 1; // The OpenAI spec
    extraOptions.max_tokens = undefined as any;
  } else {
    extraOptions.max_completion_tokens = undefined as any;
  }

  const body = {
    model,
    messages,
    temperature,
    response_format: options?.response_format,
    ...extraOptions,
  };

  const res = await fetch(openaiUrl(config.openAIBaseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAIKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${txt}`);
  }

  const json = await res.json() as any;
  const msg = json.choices?.[0]?.message?.content;
  if (!msg) throw new Error('No message from OpenAI');
  return msg.trim();
}

export async function generateCommitMessage(
  config: GitConfig,
  patch: string,
  oneLine = false
): Promise<string> {
  const instruction = oneLine
    ? 'Produce a concise (<=72 chars) one-line commit subject describing the changes.'
    : 'Produce a well-formed git commit message: a short subject (<=72 chars) and an optional body separated by a blank line. Return only the commit message text (no JSON).';

  const promptText = `Patch:\n${patch}\n\n${instruction}\nIf the patch is large, focus on main intent / key changes.`;

  return await openaiChat(config, [
    { role: 'system', content: 'You are a helpful assistant specialized in writing concise, expressive git commit messages.' },
    { role: 'user', content: promptText },
  ], { temperature: 0.2 });
}

export async function clusterChanges(config: GitConfig, items: any[]): Promise<any[]> {
  const listText = items
    .map(
      (i) =>
        `ID: ${i.id}\nFILE: ${i.file}\nKIND: ${i.kind}\nPREVIEW:\n${(i.preview || i.patch || '').slice(0, 800)}\n---`
    )
    .join('\n');
  const maxGroups = Math.max(1, Math.ceil(items.length / 10));
  const maxSingletonGroups = Math.max(0, Math.floor(items.length / 20));

  const system = `You are an expert release engineer. Cluster a list of code changes into the smallest number of coherent commit topics.

Output format (JSON only):
{ "groups": [ { "topic": "<short intent title>", "items": ["<id>", ...] }, ... ] }

Rules:
- Use only ids from the input. Include every input id exactly once.
- Prefer fewer, larger groups while keeping semantic coherence.
- Hard limits: total groups <= ${maxGroups}; single-item groups <= ${maxSingletonGroups}.
- Avoid single-item groups unless no reasonable relation exists.
- Group by shared intent, not by file/path. Common intent signals:
  - Same feature or user-facing behavior
  - Same module/package or feature directory when it reflects intent
  - Touching the same function/class/symbol or adjacent call paths
  - Rename/refactor/type/interface/API signature changes across files
  - Test and implementation pairs (including fixtures)
  - Related config, tooling, or CI changes
- Topic titles must be short (<= 6 words), describe intent, and must not be filenames or paths.
- When caps would be exceeded, merge the smallest or closest related groups; favor broader feature/refactor groupings over narrow per-file buckets.
- Bundle trivial chores (formatting, lint, type fixes, minor renames) into the most closely related group; do not create new groups for them.
- Do not create "misc" unless absolutely required by the caps.
- Return JSON only; no prose.`;

  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const user = `Here are the unstaged change items:\n\n${listText}\n\nTask:\n1) Cluster the items into intent-based commit topics following the rules above.\n2) Obey the hard caps: total groups <= ${maxGroups}; singletons <= ${maxSingletonGroups}.\n3) If you would exceed the caps, merge borderline or closely related groups until the caps are met.\n4) Use only the provided ids and include every id exactly once.\n5) Return only the JSON object in the required format. Do not include explanations or code fences.`;
    try {
      const response = await openaiChat(config, [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], { temperature: 0.2, response_format: { type: 'json_object' } });
      
      const parsed = JSON.parse(response);
      const groups = parsed.groups || parsed;
      
      const valid = groups.every((g: any) => 
        Array.isArray(g.items) && g.items.every((id: string) => items.find((it: any) => it.id === id))
      );
      
      if (!valid) throw new Error('Invalid grouping (unknown ids)');
      return groups;
    } catch (err) {
      console.warn('Clustering failed, falling back to per-file grouping. ' + String(err));
      const groups: { [k: string]: string[] } = {};
      for (const it of items) {
        groups[it.file] = groups[it.file] || [];
        groups[it.file].push(it.id);
      }
      return Object.entries(groups).map(([file, ids]) => ({ topic: `changes in ${file}`, items: ids }));
    }
  }
  throw new Error('Clustering failed repeatedly');
}

export async function pickIndependentGroup(
  config: GitConfig,
  items: ChangeItem[]
): Promise<TopicGroup> {
  const listText = items
    .map(
      (i) =>
        `ID: ${i.id}\nFILE: ${i.file}\nKIND: ${i.kind}\nPREVIEW:\n${(i.preview || i.patch || '').slice(0, 800)}\n---`
    )
    .join('\n');

  const system = `You are an expert release engineer helping to split a working tree into minimal, independent commits.\n\n` +
`Task: From the provided list of change items, choose ONE topic that can be safely committed now without depending on the remaining items. If all items clearly belong to one coherent topic, select ALL items.\n\n` +
`Output format (JSON only):\n{ "topic": "<short intent title>", "items": ["<id>", ...] }\n\n` +
`Selection rules:\n` +
`- Choose at least one id and only ids from the list.\n` +
`- Prefer the largest coherent subset that is internally consistent and does not rely on the rest.\n` +
`- Group by shared intent (feature, refactor, rename, tests+impl, config changes).\n` +
`- If changes are all the same topic (best case), include all items.\n` +
`- Avoid mixing unrelated intents.\n` +
`- Title must be short (<= 6 words), intent-focused (not a filename).`;

  const user = `Here are the unstaged change items:\n\n${listText}\n\nReturn only the JSON object.`;

  const response = await openaiChat(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.2, response_format: { type: 'json_object' } }
  );

  const parsed = JSON.parse(response);
  const topic = parsed.topic || 'changes';
  const groupItems: string[] = Array.isArray(parsed.items) ? parsed.items : [];

  if (!groupItems.length) {
    return { topic, items: items.map((i) => i.id) };
  }

  const validIds = new Set(items.map((i) => i.id));
  const filtered = groupItems.filter((id: string) => validIds.has(id));
  if (!filtered.length) {
    return { topic, items: items.map((i) => i.id) };
  }

  return { topic, items: filtered };
}