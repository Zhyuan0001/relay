import type { AgentKind } from '../domain/types.ts';
import { normalizeKey } from '../domain/rules.ts';
import type { EventStore } from '../infrastructure/event-store.ts';

export interface TaskSuggestion {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  agents: AgentKind[];
  sessionIds: string[];
  sessionCount: number;
  events: number;
  failures: number;
  startedAt: string;
  endedAt?: string;
  confidence: number;
  reason: string;
}

const GREETING =
  /^\s*(?:啊哈|早上好|上午好|下午好|晚上好|你好|您好|哈喽|嗨|hello|hi|喵)[\s!！。,.，~～…]*/i;
const FILLER = /^\s*(?:好的|好|嗯|行|可以|收到|ok|okay)[\s!！。,.，~～…]*/i;

function cleanTitle(text: string | undefined): string {
  if (!text) return '';
  let value = text.replace(/\s+/g, ' ').trim();
  value = value.replace(/^<system-reminder>[\s\S]*?<\/system-reminder>\s*/i, '').trim();
  if (/^<[a-z][^>]*>/i.test(value)) value = '';
  let previous = '';
  while (value && value !== previous) {
    previous = value;
    value = value.replace(GREETING, '').replace(FILLER, '').trim();
  }
  return value;
}

function isSubstantive(text: string): boolean {
  if (text.length < 8) return false;
  if (INSHORT.has(text)) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

const INSHORT = new Set([
  '有任务来了',
  '是这样的',
  '开始吧',
  '继续',
  '接着',
  '好的',
  '可以',
  '收到',
]);

function clipTitle(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class TaskSuggestionService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  private titleFor(sessionId: string, rawTitle: string | undefined, startedAt: string): string {
    const initial = cleanTitle(rawTitle);
    if (isSubstantive(initial)) return clipTitle(initial);
    for (const event of this.store.listPromptEvents(sessionId)) {
      const candidate = cleanTitle(event.text);
      if (isSubstantive(candidate)) return clipTitle(candidate);
    }
    if (initial) return clipTitle(initial);
    return `未命名会话 · ${startedAt.slice(0, 10)}`;
  }

  suggest(workspaceId: string): TaskSuggestion[] {
    const entry = this.store.sessionIndex().find((item) => item.workspace.id === workspaceId);
    if (!entry) return [];
    const linked = new Set(this.store.listLinkedSessionIds(workspaceId));
    const groups = new Map<string, Omit<TaskSuggestion, 'confidence' | 'reason'>>();

    for (const session of entry.sessions) {
      if (linked.has(session.id) || session.events === 0) continue;
      const title = this.titleFor(session.id, session.title, session.startedAt);
      const key = title.startsWith('未命名会话 ·') ? `solo:${session.id}` : normalizeKey(title) || `solo:${session.id}`;
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) {
        existing.sessionIds.push(session.id);
        existing.sessionCount += 1;
        existing.events += session.events;
        existing.failures += session.failures;
        if (!existing.agents.includes(session.agent)) existing.agents.push(session.agent);
        if (session.startedAt < existing.startedAt) existing.startedAt = session.startedAt;
        if (!existing.endedAt || (session.endedAt ?? session.startedAt) > existing.endedAt) {
          existing.endedAt = session.endedAt ?? session.startedAt;
        }
        continue;
      }
      groups.set(key, {
        id: `suggest-${key.slice(0, 12)}-${session.id.slice(-6)}`,
        workspaceId,
        title,
        goal: title,
        agents: [session.agent],
        sessionIds: [session.id],
        sessionCount: 1,
        events: session.events,
        failures: session.failures,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      });
    }

    return [...groups.values()]
      .map((group) => {
        const confidence = Math.min(
          0.92,
          0.55 + (group.sessionCount > 1 ? 0.1 : 0) + Math.min(0.2, group.events / 200) + (group.failures ? 0.05 : 0),
        );
        const reason =
          group.sessionCount > 1
            ? `${group.sessionCount} 个未归档会话标题一致，可合并为同一任务`
            : `会话「${group.title}」尚未关联任务，标题可直接作为任务目标`;
        return { ...group, confidence: Math.round(confidence * 100) / 100, reason };
      })
      .sort((a, b) => b.confidence - a.confidence || b.startedAt.localeCompare(a.startedAt))
      .slice(0, 24);
  }
}