import { GitConfig } from './types';

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
  let extraOptions = {max_tokens: 500, max_completion_tokens: 2000};
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

  const system = `You are an assistant that groups code changes into topics for commit staging.
Return a JSON object with a "groups" key containing an array: { "groups": [{ "topic": "<short topic title>", "items": ["id1","id2", ...] }, ...] }.
All ids must be from the provided list. If a change doesn't fit any multi-change topic, put it in its own group. Keep topics short (<=6 words).`;

  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const user = `Here are unstaged change items:\n\n${listText}\n\nGroup them by topic and return the JSON object as described.`;
    try {
      const response = await openaiChat(config, [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], { temperature: 0.2, response_format: { type: 'json_object' } });
      
      // console.log(response);
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