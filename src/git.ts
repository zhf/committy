import { runQuietGitCommand, generateId, createShortPreview } from './utils';
import { ChangeItem } from './types';

export async function collectUnstagedChanges(): Promise<ChangeItem[]> {
  const untrackedRaw = await runQuietGitCommand('git ls-files --others --exclude-standard');
  const untracked = untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : [];

  const diffRaw = await runQuietGitCommand('git diff --no-color -U0');
  const items: ChangeItem[] = [];

  if (diffRaw) {
    const parts = diffRaw.split(/\ndiff --git /).map((p, i) => (i === 0 ? p : 'diff --git ' + p));
    for (const p of parts) {
      if (!p.trim()) continue;
      
      const m = p.match(/a\/([^\s]+)\s+b\/([^\s]+)/);
      const file = m ? m[2] : '(unknown)';
      
      const hunkRegex = /(^@@[\s\S]*?)(?=(\n@@|\ndiff --git|$))/gm;
      let match;
      while ((match = hunkRegex.exec(p)) !== null) {
        const patch = match[1].trim() + '\n';
        const id = generateId('h-');
        items.push({
          id,
          file,
          kind: 'hunk',
          patch: `diff --git a/${file} b/${file}\n${patch}`,
          preview: createShortPreview(patch),
        });
      }
    }
  }

  for (const f of untracked) {
    items.push({
      id: generateId('u-'),
      file: f,
      kind: 'file',
      preview: `(untracked file) ${f}`,
    });
  }

  return items;
}

export async function getStagedFiles(): Promise<string[]> {
  const stagedNamesRaw = await runQuietGitCommand('git diff --name-only --cached');
  return stagedNamesRaw ? stagedNamesRaw.split('\n').filter(Boolean) : [];
}

export async function getStagedDiff(): Promise<string> {
  return await runQuietGitCommand('git diff --cached');
}

export async function stageItems(items: ChangeItem[]): Promise<void> {
  const { runGitCommand } = await import('./utils');
  
  for (const it of items) {
    if (it.kind === 'file') {
      await runGitCommand(['add', '--', it.file]);
    } else if (it.kind === 'hunk' && it.patch) {
      try {
        await runGitCommand(['apply', '--cached', '--unidiff-zero', '-'], { stdin: it.patch });
      } catch (err) {
        console.warn(`Patch apply failed for ${it.file}, adding file fully.`);
        await runGitCommand(['add', '--', it.file]);
      }
    }
  }
}

export async function unstageFiles(files: string[]): Promise<void> {
  const { runGitCommand } = await import('./utils');
  await runGitCommand(['reset', '--', ...files]);
}

export async function commitWithMessage(message: string): Promise<void> {
  const { runGitCommand } = await import('./utils');
  await runGitCommand(['commit', '-m', message]);
}