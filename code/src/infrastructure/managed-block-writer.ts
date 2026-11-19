import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { sha1 } from '../shared/hash.ts';

export interface WritePlan {
  path: string;
  block: string;
  before: string;
  after: string;
  changed: boolean;
  conflict: boolean;
  additions: number;
  deletions: number;
}

export function hashBlockContent(content: string): string {
  return sha1(content.trim()).slice(0, 12);
}

export function renderBlock(block: string, content: string): string {
  const normalized = content.trim();
  const hash = hashBlockContent(normalized);
  return `<!-- relay:begin ${block} hash=${hash} -->\n${normalized}\n<!-- relay:end ${block} -->`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function diffStat(before: string, after: string): { additions: number; deletions: number } {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 250_000) {
    return { additions: Math.max(0, b.length - a.length), deletions: Math.max(0, a.length - b.length) };
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const common = dp[0][0];
  return { additions: b.length - common, deletions: a.length - common };
}

function applyBlockToText(
  before: string,
  block: string,
  content: string,
): { after: string; conflict: boolean } {
  const normalized = content.trim();
  const hash = hashBlockContent(normalized);
  const pattern = new RegExp(
    '<!-- relay:begin ' +
      escapeRegExp(block) +
      ' hash=([0-9a-f]+) -->\\n?([\\s\\S]*?)<!-- relay:end ' +
      escapeRegExp(block) +
      ' -->',
  );
  const match = before.match(pattern);
  if (match) {
    const existingHash = match[1];
    const inner = match[2] ?? '';
    if (hashBlockContent(inner) !== existingHash) {
      return { after: before, conflict: true };
    }
    const blockText = `<!-- relay:begin ${block} hash=${hash} -->\n${normalized}\n<!-- relay:end ${block} -->`;
    const after =
      before.slice(0, match.index) + blockText + before.slice((match.index ?? 0) + match[0].length);
    return { after, conflict: false };
  }
  const rendered = renderBlock(block, normalized);
  const separator = before.length === 0 ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return { after: `${before}${separator}${rendered}\n`, conflict: false };
}

export function planManagedBlocks(
  filePath: string,
  blocks: Array<{ block: string; content: string }>,
): WritePlan {
  const before = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  let current = before;
  let conflict = false;
  for (const item of blocks) {
    const result = applyBlockToText(current, item.block, item.content);
    current = result.after;
    conflict = conflict || result.conflict;
  }
  const stat = diffStat(before, current);
  return {
    path: filePath,
    block: blocks.map((item) => item.block).join('+'),
    before,
    after: current,
    changed: current !== before,
    conflict,
    additions: stat.additions,
    deletions: stat.deletions,
  };
}

export function planManagedBlock(filePath: string, block: string, content: string): WritePlan {
  return planManagedBlocks(filePath, [{ block, content }]);
}

export function applyWritePlan(plan: WritePlan, options: { backupDir?: string } = {}): void {
  if (plan.conflict) {
    throw new Error(`RELAY-E004 managed block conflict: ${plan.path}#${plan.block}`);
  }
  if (!plan.changed) return;
  mkdirSync(dirname(plan.path), { recursive: true });
  const lockPath = `${plan.path}.relay.lock`;
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx');
  } catch {
    throw new Error(`RELAY-E004 write busy: ${plan.path}`);
  }
  try {
    if (existsSync(plan.path) && lstatSync(plan.path).isSymbolicLink()) {
      throw new Error(`RELAY-E004 symlink not supported: ${plan.path}`);
    }
    const current = existsSync(plan.path) ? readFileSync(plan.path, 'utf8') : '';
    if (current !== plan.before) {
      throw new Error(`RELAY-E004 stale plan: ${plan.path}`);
    }
    if (options.backupDir && existsSync(plan.path)) {
      mkdirSync(options.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      copyFileSync(plan.path, join(options.backupDir, `${basename(plan.path)}.${stamp}.bak`));
    }
    const mode = existsSync(plan.path) ? statSync(plan.path).mode & 0o777 : 0o644;
    const tmp = `${plan.path}.relay-${process.pid}.tmp`;
    writeFileSync(tmp, plan.after, { encoding: 'utf8', mode });
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, plan.path);
  } finally {
    closeSync(lockFd);
    try {
      unlinkSync(lockPath);
    } catch {
      // lock already removed
    }
  }
}
