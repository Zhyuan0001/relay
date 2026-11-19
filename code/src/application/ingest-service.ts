import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { AgentKind, LogAdapter, ParsedSession, Workspace } from '../domain/types.ts';
import type { EventStore } from '../infrastructure/event-store.ts';
import { sanitizeEvent, sanitizeText } from '../infrastructure/redactor.ts';

export interface ImportedSessionRef {
  sessionId: string;
  agent: AgentKind;
  workspaceId: string;
  workspaceName: string;
  startedAt: string;
}

export interface ImportResult {
  sources: number;
  sessions: number;
  events: number;
  errors: number;
  skipped: number;
  redactions: number;
  imported: ImportedSessionRef[];
}

export interface AutoImportResult extends ImportResult {
  affected: Array<{ workspaceId: string; name: string; sessions: number; events: number }>;
}

const AUTO_SCOPE = '__auto__';

export class IngestService {
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  register(rootPath: string, name?: string): Workspace {
    const root = resolve(rootPath);
    let gitRemote: string | undefined;
    try {
      gitRemote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      gitRemote = undefined;
    }
    return this.store.upsertWorkspace({ rootPath: root, name: name ?? basename(root), gitRemote });
  }

  import(workspaceId: string, adapters: LogAdapter[], roots: string[]): ImportResult {
    const result: ImportResult = {
      sources: 0,
      sessions: 0,
      events: 0,
      errors: 0,
      skipped: 0,
      redactions: 0,
      imported: [],
    };
    for (const adapter of adapters) {
      for (const root of roots) {
        let sources: string[] = [];
        try {
          sources = adapter.discover(root);
        } catch {
          continue;
        }
        for (const source of sources) {
          result.sources += 1;
          let stat;
          try {
            stat = statSync(source);
          } catch {
            result.errors += 1;
            continue;
          }
          const cursor = this.store.getSourceCursor(workspaceId, source);
          if (cursor && cursor.size === stat.size && cursor.mtimeMs === Math.trunc(stat.mtimeMs)) {
            result.skipped += 1;
            continue;
          }
          let sessions: ParsedSession[];
          try {
            sessions = adapter.parse(source);
          } catch (error) {
            result.errors += 1;
            this.store.recordParseError(source, 0, error instanceof Error ? error.message : String(error));
            continue;
          }
          for (const session of sessions) this.ingestSession(workspaceId, session, source, result);
          this.store.setSourceCursor(workspaceId, source, stat.size, Math.trunc(stat.mtimeMs));
        }
      }
    }
    return result;
  }

  importAuto(source: { adapter: LogAdapter; roots: string[] }, fallbackWorkspaceId?: string): AutoImportResult {
    const result: AutoImportResult = {
      sources: 0,
      sessions: 0,
      events: 0,
      errors: 0,
      skipped: 0,
      redactions: 0,
      imported: [],
      affected: [],
    };
    const affected = new Map<string, { workspaceId: string; name: string; sessions: number; events: number }>();
    for (const root of source.roots) {
      let sourcesList: string[] = [];
      try {
        sourcesList = source.adapter.discover(root);
      } catch {
        continue;
      }
      for (const file of sourcesList) {
        result.sources += 1;
        let stat;
        try {
          stat = statSync(file);
        } catch {
          result.errors += 1;
          continue;
        }
        const cursor = this.store.getSourceCursor(AUTO_SCOPE, file);
        if (cursor && cursor.size === stat.size && cursor.mtimeMs === Math.trunc(stat.mtimeMs)) {
          result.skipped += 1;
          continue;
        }
        let sessions: ParsedSession[];
        try {
          sessions = source.adapter.parse(file);
        } catch (error) {
          result.errors += 1;
          this.store.recordParseError(file, 0, error instanceof Error ? error.message : String(error));
          continue;
        }
        for (const session of sessions) {
          const workspace = this.workspaceForSession(session, fallbackWorkspaceId);
          const beforeEvents = result.events;
          this.ingestSession(workspace.id, session, file, result);
          const group = affected.get(workspace.id) ?? {
            workspaceId: workspace.id,
            name: workspace.name,
            sessions: 0,
            events: 0,
          };
          group.sessions += 1;
          group.events += result.events - beforeEvents;
          affected.set(workspace.id, group);
        }
        this.store.setSourceCursor(AUTO_SCOPE, file, stat.size, Math.trunc(stat.mtimeMs));
      }
    }
    result.affected = [...affected.values()];
    return result;
  }

  private workspaceForSession(session: ParsedSession, fallbackWorkspaceId?: string): Workspace {
    if (session.workspacePath) {
      const path = resolve(session.workspacePath);
      const existing = this.store.getWorkspaceByPath(path);
      if (existing) return existing;
      return this.store.upsertWorkspace({ rootPath: path, name: basename(path) });
    }
    if (fallbackWorkspaceId) {
      const fallback = this.store.getWorkspace(fallbackWorkspaceId);
      if (fallback) return fallback;
    }
    const unsorted = join(homedir(), 'Relay-Unsorted');
    return this.store.getWorkspaceByPath(unsorted) ?? this.store.upsertWorkspace({ rootPath: unsorted, name: '未归类' });
  }

  private ingestSession(
    workspaceId: string,
    session: ParsedSession,
    source: string,
    result: ImportResult,
  ): void {
    result.sessions += 1;
    const sanitizedTitle = session.title ? sanitizeText(session.title).text : undefined;
    const sessionKey = this.store.upsertSession(workspaceId, { ...session, title: sanitizedTitle });
    const events = session.events.map((event) => {
      const sanitized = sanitizeEvent({
        ...event,
        id: `${sessionKey}:${event.id}`,
        sessionId: sessionKey,
      });
      result.redactions += sanitized.hits.reduce((sum, hit) => sum + hit.count, 0);
      const sourcePath = sanitizeText(event.provenance.sourcePath).text;
      return {
        ...sanitized.event,
        provenance: { ...event.provenance, sourcePath },
      };
    });
    result.events += this.store.appendEvents(events);
    const workspace = this.store.getWorkspace(workspaceId);
    result.imported.push({
      sessionId: sessionKey,
      agent: session.agent,
      workspaceId,
      workspaceName: workspace?.name ?? basename(workspaceId),
      startedAt: session.startedAt,
    });
    for (const parseError of session.errors) {
      result.errors += 1;
      this.store.recordParseError(source, parseError.line, parseError.message);
    }
  }
}
