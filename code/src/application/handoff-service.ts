import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentKind, Handoff } from '../domain/types.ts';
import type { EventStore } from '../infrastructure/event-store.ts';
import {
  applyWritePlan,
  planManagedBlock,
  planManagedBlocks,
  type WritePlan,
} from '../infrastructure/managed-block-writer.ts';
import { sanitizeText, wrapUntrusted } from '../infrastructure/redactor.ts';
import { agentLabel, categoryLabel, TASK_STATUS_LABELS } from '../domain/labels.ts';

export interface BriefResult {
  text: string;
  tokens: number;
}

export interface WriteHandoffResult {
  handoff: Handoff;
  brief: string;
  files: WritePlan[];
}

const MAX_TOKENS = 1500;
const MAX_CHARS = MAX_TOKENS * 4;
const MAX_LINES = 120;

function summarize(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export class HandoffService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  buildBrief(taskId: string, targetAgent: AgentKind = 'unknown'): BriefResult {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const items = this.store.listDossier(task.workspaceId);
    const rules = items.filter((item) => item.category !== 'environment');
    const environment = items.filter((item) => item.category === 'environment');
    const events = this.store.listEventsForWorkspace(task.workspaceId);
    const failures = events
      .filter((event) => event.type === 'tool_result' && event.success === false)
      .slice(-5)
      .map((event) => {
        const snippet = summarize(event.output ?? '(无输出)');
        return `- ${wrapUntrusted(`tool_result:${event.provenance.lineNo}`, snippet).replace(/\n/g, '\n  ')}`;
      });
    const sessions = this.store.listTaskSessionIds(taskId);
    const safe = (value: string | undefined): string => (value ? sanitizeText(value).text : '');
    const ruleLines = rules.map((item) => `- ${categoryLabel(item.category)}：${item.statement}`);
    const envLines = environment.map((item) => `- ${item.statement}`);
    const sections: Record<string, string[]> = {
      header: [
        `# 交接简报 · ${safe(task.title)}`,
        '',
        `> 目标 agent：${agentLabel(targetAgent)} · 任务更新：${task.updatedAt}`,
        '',
      ],
      task: ['## 当前任务', safe(task.goal) || '（未填写）', ''],
      status: [
        '## 当前状态',
        `${TASK_STATUS_LABELS[task.status]}${task.nextStep ? `；下一步：${safe(task.nextStep)}` : ''}`,
        '',
      ],
      decisions: ['## 已确认决策', ...(ruleLines.length ? ruleLines : ['- （暂无）']), ''],
      failures: ['## 失败尝试（不要重复）', ...(failures.length ? failures : ['- （暂无）']), ''],
      environment: ['## 环境', ...(envLines.length ? envLines : ['- （暂无）']), ''],
      next: ['## 下一步', safe(task.nextStep) || '按验收条件继续', ''],
      acceptance: ['## 验收条件', safe(task.acceptance) || '（未填写）', ''],
      evidence: ['## 证据', `- 关联会话 ${sessions.length} 个；档案 ${items.length} 条；最近失败 ${failures.length} 条`, ''],
    };
    const order = ['header', 'task', 'status', 'decisions', 'failures', 'environment', 'next', 'acceptance', 'evidence'];
    const render = (): string => `${order.flatMap((key) => sections[key]).join('\n').trimEnd()}\n`;
    const over = (): boolean => render().length > MAX_CHARS || render().split('\n').length > MAX_LINES;

    while (over()) {
      if (ruleLines.length > 6) {
        ruleLines.pop();
        sections.decisions = ['## 已确认决策', ...ruleLines, ''];
      } else if (failures.length > 2) {
        failures.pop();
        sections.failures = ['## 失败尝试（不要重复）', ...failures, ''];
      } else if (ruleLines.length > 3) {
        ruleLines.pop();
        sections.decisions = ['## 已确认决策', ...ruleLines, ''];
      } else if (envLines.length > 1) {
        envLines.pop();
        sections.environment = ['## 环境', ...envLines, ''];
      } else if (failures.length > 1) {
        failures.pop();
        sections.failures = ['## 失败尝试（不要重复）', ...failures, ''];
      } else if (sections.evidence[1] !== '- （已裁剪，预算 1,500 token）') {
        sections.evidence = ['## 证据', '- （已裁剪，预算 1,500 token）', ''];
      } else {
        sections.decisions = ['## 已确认决策', '- （超出预算，请查看档案）', ''];
        sections.failures = ['## 失败尝试（不要重复）', '- （超出预算，请查看时间线）', ''];
        sections.environment = ['## 环境', '- （超出预算）', ''];
        break;
      }
    }

    const text = render();
    return { text, tokens: Math.ceil(text.length / 4) };
  }

  write(
    taskId: string,
    targetAgent: AgentKind,
    options: { workspaceRoot?: string; backupDir?: string } = {},
  ): WriteHandoffResult {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const workspace = this.store.getWorkspace(task.workspaceId);
    const root = options.workspaceRoot ?? workspace?.rootPath;
    if (!root) throw new Error(`workspace not found for task: ${taskId}`);
    mkdirSync(root, { recursive: true });

    const { text: brief } = this.buildBrief(taskId, targetAgent);
    const items = this.store.listDossier(task.workspaceId);
    const rules = items.filter((item) => item.category !== 'environment');
    const environment = items.filter((item) => item.category === 'environment');
    const habitsContent = rules.length
      ? rules.map((item) => `- ${categoryLabel(item.category)}：${item.statement}`).join('\n')
      : '- （暂无）';
    const envContent = environment.length
      ? environment.map((item) => `- ${item.statement}`).join('\n')
      : '- （暂无）';
    const pointer = '- 开工前先读 HANDOFF.md（由 Relay 维护）';

    const primaryFile = targetAgent === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
    const primaryPath = join(root, primaryFile);
    const handoffPath = join(root, 'HANDOFF.md');
    const plans: WritePlan[] = [
      planManagedBlocks(primaryPath, [
        { block: 'habits', content: habitsContent },
        { block: 'environment', content: envContent },
        { block: 'relay-pointer', content: pointer },
      ]),
      planManagedBlock(handoffPath, 'handoff', brief),
    ];
    const conflict = plans.find((plan) => plan.conflict);
    if (conflict) {
      throw new Error(`RELAY-E004 managed block conflict: ${conflict.path}#${conflict.block}`);
    }
    for (const plan of plans) applyWritePlan(plan, { backupDir: options.backupDir ?? join(root, '.relay', 'backup') });
    const handoff = this.store.createHandoff({ taskId, targetAgent, brief, state: 'Written' });
    this.store.updateTaskOwner(taskId, targetAgent);
    this.store.audit('system', 'handoff.written', handoff.id, JSON.stringify({ targetAgent, files: plans.map((plan) => plan.path) }));
    return { handoff, brief, files: plans };
  }

  claim(handoffId: string): boolean {
    const handoff = this.store.getHandoff(handoffId);
    if (!handoff || !this.store.claimHandoff(handoffId)) return false;
    this.store.updateTaskOwner(handoff.taskId, handoff.targetAgent);
    this.store.updateTaskStatus(handoff.taskId, 'in-progress');
    return true;
  }
}
