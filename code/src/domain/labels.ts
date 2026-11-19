import type { AgentKind, CandidateCategory, Task } from './types.ts';

export const CATEGORY_LABELS: Record<CandidateCategory, string> = {
  command: '命令与包管理',
  style: '命名与风格',
  dependency: '依赖与工具',
  structure: '目录结构',
  testing: '测试',
  docs: '文档与注释',
  language: '语言',
  banned: '禁用项',
  release: '发布流程',
  environment: '环境',
  decision: '决策',
  'failed-attempt': '失败尝试',
  task: '任务',
};

export function categoryLabel(category: CandidateCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export const TASK_STATUS_LABELS: Record<Task['status'], string> = {
  open: '进行中',
  'in-progress': '进行中',
  blocked: '被阻塞',
  done: '已完成',
};

export const AGENT_LABELS: Record<AgentKind, string> = {
  qoder: 'Qoder',
  'claude-code': 'Claude Code',
  antigravity: 'Antigravity',
  codex: 'Codex',
  'roo-code': 'Roo Code',
  gemini: 'Gemini CLI',
  'deepseek-harness': 'DeepSeek Harness',
  opencode: 'OpenCode',
  cline: 'Cline',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  aider: 'Aider',
  kimi: 'Kimi Code',
  kiro: 'Kiro',
  devin: 'Devin',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  pi: 'Pi',
  minimax: 'MiniMax Code',
  grok: 'Grok',
  generic: '通用 JSONL',
  unknown: '通用 agent',
};

export function agentLabel(agent: AgentKind): string {
  return AGENT_LABELS[agent] ?? agent;
}
