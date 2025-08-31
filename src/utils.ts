import { execa, execaCommand } from 'execa';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export async function runGitCommand(cmd: string | string[], opts: { stdin?: string } = {}) {
  try {
    if (Array.isArray(cmd)) {
      return await execa('git', cmd, { input: opts.stdin, all: true });
    }
    if (opts.stdin) {
      return await execaCommand(`git ${cmd}`, { input: opts.stdin, all: true });
    }
    return await execaCommand(`git ${cmd}`, { all: true });
  } catch (err: any) {
    throw new Error(`git ${cmd} failed: ${err?.message || JSON.stringify(err)}`);
  }
}

export async function runQuietGitCommand(cmd: string): Promise<string> {
  try {
    const res = await execaCommand(cmd);
    return res.stdout.trim();
  } catch {
    return '';
  }
}

export function generateId(prefix = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function createShortPreview(patch: string): string {
  const lines = patch.split('\n').slice(0, 6);
  return lines.join('\n');
}

export function truncateString(input: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (input.length <= maxLength) return input;
  if (maxLength <= 1) return input.slice(0, maxLength);
  return input.slice(0, Math.max(0, maxLength - 1)) + '…';
}

export function toSingleLine(input: string): string {
  return input.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderSimpleTable(
  headers: string[],
  rows: string[][],
  options: { maxWidth?: number; gutter?: string; columnMaxWidths?: number[] } = {}
): string {
  const gutter = options.gutter ?? '  ';
  const terminalWidth = options.maxWidth ?? (process.stdout && process.stdout.columns ? process.stdout.columns : 100);

  const baseMaxes = options.columnMaxWidths ?? [];
  const columnCount = headers.length;

  const content = [headers, ...rows];
  const naturalWidths = new Array<number>(columnCount).fill(0);
  for (let c = 0; c < columnCount; c++) {
    let maxLen = 0;
    for (const row of content) {
      const cell = row[c] ?? '';
      maxLen = Math.max(maxLen, String(cell).length);
    }
    naturalWidths[c] = maxLen;
  }

  const fixedMaxes = naturalWidths.map((w, i) => {
    if (typeof baseMaxes[i] === 'number' && baseMaxes[i]! > 0) return Math.min(w, baseMaxes[i]!);
    return w;
  });

  const totalGutterWidth = gutter.length * (columnCount - 1);
  let availableWidth = Math.max(20, terminalWidth - totalGutterWidth);

  const computed = new Array<number>(columnCount).fill(0);
  const nonFlexibleColumns = columnCount - 1;
  for (let i = 0; i < columnCount - 1; i++) {
    const cap = typeof baseMaxes[i] === 'number' && baseMaxes[i]! > 0 ? baseMaxes[i]! : fixedMaxes[i];
    computed[i] = Math.min(fixedMaxes[i], cap);
    availableWidth -= computed[i];
  }
  computed[columnCount - 1] = Math.max(10, availableWidth);

  const pad = (str: string, width: number): string => {
    const s = truncateString(str, width);
    if (s.length >= width) return s;
    return s + ' '.repeat(width - s.length);
  };

  const preparedRows = content.map((row, rIdx) => {
    const cells = row.map((cell, cIdx) => {
      const str = toSingleLine(String(cell ?? ''));
      return pad(str, computed[cIdx]);
    });
    return cells.join(gutter);
  });

  const headerLine = preparedRows[0];
  const separatorLine = '-'.repeat(Math.min(headerLine.length, terminalWidth));
  const dataLines = preparedRows.slice(1);
  return [headerLine, separatorLine, ...dataLines].join('\n');
}

export function renderBox(text: string, options: { padding?: number } = {}): string {
  const padding = Math.max(0, options.padding ?? 1);
  const pad = ' '.repeat(padding);
  const lines = (text || '').split('\n');
  const contentLines = lines.map((line) => pad + line + pad);
  const width = contentLines.reduce((max, line) => Math.max(max, line.length), 0);
  const top = '+' + '-'.repeat(width) + '+';
  const body = contentLines
    .map((line) => '|' + line + ' '.repeat(width - line.length) + '|')
    .join('\n');
  const bottom = '+' + '-'.repeat(width) + '+';
  return [top, body, bottom].join('\n');
}

export async function openInExternalEditor(initial: string): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `committy-${Date.now()}.txt`);
  try {
    await fs.writeFile(filePath, (initial ?? '') + '\n', 'utf8');
    let editorCommand = process.env.VISUAL || process.env.EDITOR || '';
    if (!editorCommand) {
      try {
        // Respect git's configured editor if available
        editorCommand = await runQuietGitCommand('git var GIT_EDITOR');
      } catch {}
    }
    if (!editorCommand) editorCommand = 'vi';

    const tokens = splitCommandIntoTokens(editorCommand.trim());
    const args: string[] = [];
    for (const token of tokens.slice(1)) {
      if (token === '%s' || token === '$1' || token === '$FILE') {
        args.push(filePath);
      } else {
        args.push(token);
      }
    }
    if (!tokens.slice(1).some(t => t === '%s' || t === '$1' || t === '$FILE')) {
      args.push(filePath);
    }

    const program = tokens[0] || 'vi';
    await execa(program, args, { stdio: 'inherit' });
    const edited = await fs.readFile(filePath, 'utf8');
    return edited;
  } catch {
    return null;
  } finally {
    try { await fs.unlink(filePath); } catch {}
  }
}

function splitCommandIntoTokens(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaping = false;
  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && !inSingle) {
      escaping = true;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}
