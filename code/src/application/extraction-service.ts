import type { CandidateCategory, CandidateDraft, RawEvent } from '../domain/types.ts';
import {
  classifyStatement,
  isBuildCommand,
  isTestCommand,
  isVersionCommand,
  looksLikeCorrection,
  normalizeKey,
  normalizePreference,
  normalizeStatement,
  packageManagerIn,
  toolCommand,
} from '../domain/rules.ts';
import { sha1 } from '../shared/hash.ts';
import type { EventStore } from '../infrastructure/event-store.ts';

export interface ExtractionResult {
  corrections: number;
  candidates: number;
}

function positivePackageManager(text: string): string | undefined {
  const match = text.match(/(?:用|使用|优先|统一用|改用)\s*(pnpm|npm|yarn|bun)\b/i);
  return match?.[1]?.toLowerCase();
}

function topSegment(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = path.replace(/\\/g, '/');
  const match = normalized.match(/\/(src|docs|scripts|tests|fixtures|assets|app|packages)\//);
  return match?.[1];
}

export class ExtractionService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  extract(workspaceId: string): ExtractionResult {
    const events = this.store.listEventsForWorkspace(workspaceId);
    const corrections = this.deriveCorrections(events);
    const insertedCorrections = this.store.appendEvents(corrections);
    const drafts = new Map<string, CandidateDraft>();
    const knownKeys = new Map<string, string>();
    for (const item of this.store.listCandidates(workspaceId, 'pending')) {
      knownKeys.set(`${item.category}|${normalizeKey(item.statement)}`, item.statement);
    }

    const add = (
      category: CandidateCategory,
      statement: string,
      confidence: number,
      evidenceEventIds: string[],
    ): void => {
      const normalized = normalizeStatement(statement);
      if (!normalized || normalized.length < 4) return;
      const looseKey = `${category}|${normalizeKey(normalized)}`;
      const canonical = knownKeys.get(looseKey) ?? normalized;
      if (!knownKeys.has(looseKey)) knownKeys.set(looseKey, normalized);
      const key = `${category}|${canonical}`;
      const existing = drafts.get(key);
      if (existing) {
        existing.evidenceEventIds = [...new Set([...existing.evidenceEventIds, ...evidenceEventIds])];
        existing.confidence = Math.max(existing.confidence, confidence);
      } else {
        drafts.set(key, {
          category,
          statement: canonical,
          confidence: Math.min(0.95, Math.max(0.35, confidence)),
          scope: 'project',
          evidenceEventIds: [...new Set(evidenceEventIds)],
        });
      }
    };

    for (const event of corrections) {
      if (!event.text) continue;
      const positive = positivePackageManager(event.text);
      const negative = event.text.match(/不要\s*(?:用|使用)?\s*(npm|yarn|bun|pnpm)\b/i)?.[1]?.toLowerCase();
      if (positive) {
        add('command', `使用 ${positive}`, 0.85, [event.id]);
        if (negative && negative !== positive) add('banned', `不要使用 ${negative}`, 0.82, [event.id]);
        continue;
      }
      const categories = classifyStatement(event.text);
      const category = categories[0] ?? 'style';
      add(category, normalizePreference(event.text), 0.85, [event.id]);
    }

    for (const event of events) {
      if (event.type !== 'prompt' || !event.text) continue;
      const positive = positivePackageManager(event.text);
      if (positive && /以后都|优先|统一|记住|改用/.test(event.text)) {
        add('command', `优先使用 ${positive}`, 0.8, [event.id]);
      }
    }

    const commandGroups = new Map<string, { count: number; ids: string[] }>();
    for (const event of events) {
      if (event.type !== 'tool_call') continue;
      const command = toolCommand(event);
      if (!command) continue;
      const normalized = command.replace(/\s+/g, ' ').trim();
      const group = commandGroups.get(normalized) ?? { count: 0, ids: [] };
      group.count += 1;
      group.ids.push(event.id);
      commandGroups.set(normalized, group);
    }
    for (const [command, group] of commandGroups) {
      const confidence = 0.55 + Math.min(group.count, 4) * 0.1;
      if (isTestCommand(command)) {
        add('testing', command, confidence, group.ids);
      } else if (isBuildCommand(command)) {
        add('command', command, confidence, group.ids);
      } else if (packageManagerIn(command)) {
        add('command', command, confidence, group.ids);
      }
      if (isVersionCommand(command)) {
        add('environment', command, Math.max(confidence, 0.6), group.ids);
      }
    }

    const dirGroups = new Map<string, { count: number; ids: string[] }>();
    for (const event of events) {
      if (event.type !== 'edit') continue;
      const segment = topSegment(event.filePath);
      if (!segment) continue;
      const group = dirGroups.get(segment) ?? { count: 0, ids: [] };
      group.count += 1;
      group.ids.push(event.id);
      dirGroups.set(segment, group);
    }
    for (const [segment, group] of dirGroups) {
      if (group.count >= 2) {
        add('structure', `文件主要放在 ${segment}/`, 0.5 + Math.min(group.count, 4) * 0.08, group.ids);
      }
    }

    const selected = [...drafts.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 40);
    for (const draft of selected) {
      this.store.upsertCandidate(workspaceId, draft);
    }
    this.markConflicts(workspaceId);
    return { corrections: insertedCorrections, candidates: selected.length };
  }

  private deriveCorrections(events: RawEvent[]): RawEvent[] {
    const corrections: RawEvent[] = [];
    for (const event of events) {
      if (event.type !== 'prompt' || !event.text || !looksLikeCorrection(event.text)) continue;
      corrections.push({
        ...event,
        id: `corr:${sha1(event.id)}`,
        type: 'correction',
        role: 'user',
        provenance: { ...event.provenance, sourcePath: 'derived' },
      });
    }
    return corrections;
  }

  private markConflicts(workspaceId: string): void {
    const pending = this.store.listCandidates(workspaceId, 'pending').filter((item) => item.category === 'command');
    const pnpm = pending.filter((item) => /\bpnpm\b/.test(item.statement));
    const npm = pending.filter((item) => /\bnpm\b/.test(item.statement));
    if (!pnpm.length || !npm.length) return;
    for (const item of [...pnpm, ...npm]) this.store.setCandidateStatus(item.id, 'conflict');
  }
}
