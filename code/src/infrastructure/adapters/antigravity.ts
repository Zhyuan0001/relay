import { DatabaseSync } from 'node:sqlite';
import { basename } from 'node:path';
import type { LogAdapter, ParsedSession, RawEvent } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { fileMtimeIso, walkFiles, toIso } from './parse-utils.ts';

interface SummaryRow {
  conversation_id: string;
  title?: string | null;
  preview?: string | null;
  step_count?: number | null;
  last_modified_time?: unknown;
  workspace_uris?: string | null;
  status?: string | null;
  source?: string | null;
  project_id?: string | null;
  agent_name?: string | null;
  parent_conversation_id?: string | null;
  nesting_depth?: number | null;
}

function parseWorkspace(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    const decode = (input: string): string => {
      try {
        return decodeURIComponent(input.replace(/^file:\/\//, ''));
      } catch {
        return input;
      }
    };
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return decode(parsed[0]);
    if (typeof parsed === 'string') return decode(parsed);
  } catch {
    return value.split(',')[0]?.trim();
  }
  return undefined;
}

export class AntigravitySummaryAdapter implements LogAdapter {
  id = 'antigravity' as const;

  discover(root: string): string[] {
    return walkFiles(root, (path) => basename(path) === 'conversation_summaries.db');
  }


  probe(path: string) {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(path, { readOnly: true });
    } catch (error) {
      return { format: 'antigravity-summary-sqlite', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    try {
      let version: string | undefined;
      try {
        const row = db.prepare('SELECT version FROM search_schema_version LIMIT 1').get() as { version?: unknown } | undefined;
        if (row?.version !== undefined) version = String(row.version);
      } catch {
        // older schema without search_schema_version
      }
      return { format: 'antigravity-summary-sqlite', version, ok: true };
    } catch (error) {
      return { format: 'antigravity-summary-sqlite', ok: false, detail: error instanceof Error ? error.message : String(error) };
    } finally {
      db.close();
    }
  }

  parse(path: string): ParsedSession[] {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(path, { readOnly: true });
    } catch {
      db = new DatabaseSync(path);
    }
    try {
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, step_count, last_modified_time, workspace_uris,
                  status, source, project_id, agent_name, parent_conversation_id, nesting_depth
           FROM conversation_summaries`,
        )
        .all() as unknown as SummaryRow[];
      const fallback = fileMtimeIso(path);
      return rows.map((row, index) => {
        const occurredAt = toIso(row.last_modified_time, fallback);
        const sessionId = String(row.conversation_id);
        const workspacePath = parseWorkspace(row.workspace_uris);
        const text = [
          row.title ?? '(untitled)',
          `${row.step_count ?? 0} steps`,
          row.status ?? '',
          row.agent_name ? `agent=${row.agent_name}` : '',
          row.parent_conversation_id ? `parent=${row.parent_conversation_id}` : '',
          row.nesting_depth ? `depth=${row.nesting_depth}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const event: RawEvent = {
          id: stableEventId([sessionId, 'summary', text]),
          sessionId,
          type: 'summary',
          occurredAt,
          text,
          provenance: {
            agent: 'antigravity',
            sourcePath: path,
            lineNo: index + 1,
            blockIndex: 0,
            occurredAt,
          },
        };
        return {
          agent: 'antigravity' as const,
          sessionId,
          workspacePath,
          startedAt: occurredAt,
          endedAt: occurredAt,
          title: row.title ?? undefined,
          sourcePath: path,
          originKind: 'summary',
          events: [event],
          errors: [],
        };
      });
    } finally {
      db.close();
    }
  }
}
