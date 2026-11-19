import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { categoryLabel } from '../domain/labels.ts';
import type { EventStore } from '../infrastructure/event-store.ts';
import {
  applyWritePlan,
  planManagedBlock,
  type WritePlan,
} from '../infrastructure/managed-block-writer.ts';

export interface ProjectionTarget {
  path: string;
  harnesses: string[];
}

export const PROJECTION_TARGETS: ProjectionTarget[] = [
  { path: 'AGENTS.md', harnesses: ['qoder', 'codex', 'antigravity', 'deepseek-harness', 'opencode', 'kimi', 'pi', 'minimax', 'grok', 'devin'] },
  { path: 'CLAUDE.md', harnesses: ['claude-code'] },
  { path: 'GEMINI.md', harnesses: ['gemini'] },
  { path: 'CONVENTIONS.md', harnesses: ['aider'] },
  { path: '.windsurfrules', harnesses: ['windsurf'] },
  { path: '.clinerules/relay.md', harnesses: ['cline'] },
  { path: '.roo/rules/relay.md', harnesses: ['roo-code'] },
  { path: '.cursor/rules/relay.mdc', harnesses: ['cursor'] },
  { path: '.qoder/rules/relay.md', harnesses: ['qoder'] },
  { path: '.kiro/steering/relay.md', harnesses: ['kiro'] },
];

export interface ProjectionPlan {
  target: ProjectionTarget;
  plan: WritePlan;
  exists: boolean;
}

export interface ProjectionResult {
  path: string;
  harnesses: string[];
  changed: boolean;
  conflict: boolean;
  additions: number;
  deletions: number;
}

export class ProjectionService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  profileContent(workspaceId: string): string {
    const items = this.store.listDossier(workspaceId);
    const habits = items.filter((item) => item.category !== 'environment');
    const environment = items.filter((item) => item.category === 'environment');
    const lines = [
      '## Relay 项目规范',
      '> 由 Relay 从会话证据中提炼，人工审核后生成。',
      '',
      '### 习惯与规范',
      ...(habits.length ? habits.map((item) => `- ${categoryLabel(item.category)}：${item.statement}`) : ['- （暂无）']),
      '',
      '### 环境',
      ...(environment.length ? environment.map((item) => `- ${item.statement}`) : ['- （暂无）']),
    ];
    return lines.join('\n');
  }

  plan(workspaceId: string): ProjectionPlan[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
    const content = this.profileContent(workspaceId);
    return PROJECTION_TARGETS.map((target) => {
      const filePath = join(workspace.rootPath, target.path);
      return {
        target,
        plan: planManagedBlock(filePath, 'relay-profile', content),
        exists: existsSync(filePath),
      };
    });
  }

  apply(workspaceId: string, paths?: string[]): ProjectionResult[] {
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
    const selected = paths?.length ? new Set(paths) : null;
    const plans = this.plan(workspaceId).filter((entry) => !selected || selected.has(entry.target.path));
    const conflict = plans.find((entry) => entry.plan.conflict);
    if (conflict) throw new Error(`RELAY-E004 managed block conflict: ${conflict.plan.path}`);
    for (const entry of plans) {
      applyWritePlan(entry.plan, { backupDir: join(workspace.rootPath, '.relay', 'backup') });
    }
    this.store.audit(
      'system',
      'projection.applied',
      workspaceId,
      JSON.stringify(plans.map((entry) => entry.target.path)),
    );
    return plans.map((entry) => ({
      path: entry.target.path,
      harnesses: entry.target.harnesses,
      changed: entry.plan.changed,
      conflict: entry.plan.conflict,
      additions: entry.plan.additions,
      deletions: entry.plan.deletions,
    }));
  }
}

export function summarizeProjection(plan: ProjectionPlan): ProjectionResult {
  return {
    path: plan.target.path,
    harnesses: plan.target.harnesses,
    changed: plan.plan.changed,
    conflict: plan.plan.conflict,
    additions: plan.plan.additions,
    deletions: plan.plan.deletions,
  };
}
