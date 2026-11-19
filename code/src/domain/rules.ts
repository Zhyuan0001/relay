import type { CandidateCategory } from './types.ts';

const CATEGORY_RULES: Array<{ category: CandidateCategory; re: RegExp; priority: number }> = [
  { category: 'banned', re: /不要|禁止|别用|避免|don't|do not/i, priority: 10 },
  { category: 'command', re: /\b(pnpm|npm|yarn|bun|pip|cargo|go)\b|npm run|pnpm run|yarn |bun run/i, priority: 9 },
  { category: 'dependency', re: /\b(Electron|Tauri|React|Vue|FastAPI|Prisma|SQLite|better-sqlite3|Vite|Element Plus|ECharts)\b/i, priority: 8 },
  { category: 'testing', re: /测试|pytest|vitest|jest|npm test|pnpm test|\btest\b/i, priority: 7 },
  { category: 'style', re: /命名|驼峰|下划线|PascalCase|camelCase|kebab|缩进|格式化|分号|引号|风格/i, priority: 6 },
  { category: 'docs', re: /文档|README|AGENTS\.md|CLAUDE\.md|注释|docstring/i, priority: 5 },
  { category: 'language', re: /中文|英文|语言/i, priority: 4 },
  { category: 'structure', re: /目录|文件夹|docs\/|scripts\/|src\/|tests\/|结构/i, priority: 3 },
  { category: 'release', re: /打包|发布|build|electron-builder|版本号|产物|artifact/i, priority: 2 },
];

export const CORRECTION_RE =
  /不要|别用|禁止|避免|改用|换成|不是|应该|以后都|以后|记住|优先|保持|注意|don't|do not|use .+ instead/i;

export function looksLikeCorrection(text: string): boolean {
  return CORRECTION_RE.test(text);
}

export function classifyStatement(text: string): CandidateCategory[] {
  return CATEGORY_RULES.filter((rule) => rule.re.test(text))
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => rule.category);
}

export function normalizeStatement(text: string, maxLength = 160): string {
  let value = text.replace(/\s+/g, ' ').trim();
  value = value.replace(/^[，。；：、\s]+/, '').replace(/[。；\s]+$/, '');
  value = value.replace(/^(?:(?:以后都|以后|请|记住|注意|要|应该)[，,：:\s]*)+/, '');
  if (value.length > maxLength) value = `${value.slice(0, maxLength - 1)}…`;
  return value;
}

export function preferenceClause(text: string): string {
  const clauses = text
    .split(/[。；;!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const preferred = [...clauses]
    .reverse()
    .find((clause) => /不要|禁止|避免|以后|优先|统一|记住|改用|保持/.test(clause));
  return preferred ?? clauses[clauses.length - 1] ?? text;
}

export function normalizePreference(text: string): string {
  return normalizeStatement(preferenceClause(text));
}

export function toolCommand(event: { tool?: string; input?: unknown }): string | undefined {
  if (event.tool !== 'Bash' && event.tool !== 'Shell' && event.tool !== 'bash') return undefined;
  const input = event.input as Record<string, unknown> | undefined;
  const command = input?.command ?? input?.cmd ?? input?.script;
  return typeof command === 'string' ? command : undefined;
}

export function packageManagerIn(text: string): string | undefined {
  const match = text.match(/\b(pnpm|npm|yarn|bun)\b/i);
  return match?.[1]?.toLowerCase();
}

export function isTestCommand(command: string): boolean {
  return /\b(pytest|vitest|jest|npm test|pnpm test|yarn test|bun test|node --test)\b/i.test(command);
}

export function isBuildCommand(command: string): boolean {
  return /\b(build|electron-builder|vite build|package|pack)\b/i.test(command);
}

export function isVersionCommand(command: string): boolean {
  return /\b(node|python3?|pnpm|npm|yarn|bun|cargo|go)\b\s+(-v|--version)\b/i.test(command);
}

export function isEditTool(tool: string | undefined): boolean {
  if (!tool) return false;
  return /^(Edit|Write|ApplyPatch|MultiEdit|str_replace_editor|NotebookEdit)$/i.test(tool);
}

export function editFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const value = record.file_path ?? record.path ?? record.filePath ?? record.filename;
  return typeof value === 'string' ? value : undefined;
}


export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}
