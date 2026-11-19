import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  Candidate,
  CandidateDraft,
  CandidateStatus,
  DossierItem,
  DossierVersion,
  Handoff,
  HandoffState,
  ParsedSession,
  RawEvent,
  SearchHit,
  Stats,
  Task,
  Workspace,
  AgentKind,
} from '../domain/types.ts';

const NOW = () => new Date().toISOString();

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  git_remote TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  source_path TEXT,
  title TEXT,
  origin_kind TEXT NOT NULL DEFAULT 'real',
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id, agent);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT,
  role TEXT,
  text TEXT,
  tool TEXT,
  input_json TEXT,
  output TEXT,
  success INTEGER,
  file_path TEXT,
  provenance_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, occurred_at);
CREATE TABLE IF NOT EXISTS source_cursors (
  workspace_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, source_path)
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, category, statement)
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(workspace_id, status, confidence);
CREATE TABLE IF NOT EXISTS dossier_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dossier_workspace ON dossier_items(workspace_id, status);
CREATE TABLE IF NOT EXISTS dossier_versions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  diff_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(item_id, version_no),
  FOREIGN KEY (item_id) REFERENCES dossier_items(id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_agent TEXT,
  next_step TEXT,
  acceptance TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_sessions (
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (task_id, session_id)
);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  state TEXT NOT NULL,
  brief TEXT NOT NULL,
  written_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handoffs_state ON handoffs(state, task_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parse_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

interface EventRow {
  id: string;
  session_id: string;
  type: string;
  occurred_at: string;
  role: string | null;
  text: string | null;
  tool: string | null;
  input_json: string | null;
  output: string | null;
  success: number | null;
  file_path: string | null;
  provenance_json: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class EventStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  upsertWorkspace(input: { rootPath: string; name: string; gitRemote?: string }): Workspace {
    const existing = this.db
      .prepare('SELECT * FROM workspaces WHERE root_path = ?')
      .get(input.rootPath) as Record<string, unknown> | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE workspaces SET name = ?, git_remote = ? WHERE id = ?')
        .run(input.name, input.gitRemote ?? null, existing.id as string);
      return this.getWorkspace(existing.id as string)!;
    }
    const workspace: Workspace = {
      id: randomUUID(),
      rootPath: input.rootPath,
      name: input.name,
      gitRemote: input.gitRemote,
      createdAt: NOW(),
    };
    this.db
      .prepare('INSERT INTO workspaces (id, root_path, name, git_remote, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspace.id, workspace.rootPath, workspace.name, workspace.gitRemote ?? null, workspace.createdAt);
    return workspace;
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapWorkspace(row) : undefined;
  }

  getWorkspaceByPath(rootPath: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE root_path = ?')
      .get(rootPath) as Record<string, unknown> | undefined;
    return row ? this.mapWorkspace(row) : undefined;
  }

  listWorkspaces(): Workspace[] {
    return (this.db.prepare('SELECT * FROM workspaces ORDER BY created_at').all() as Record<string, unknown>[]).map(
      (row) => this.mapWorkspace(row),
    );
  }

  private mapWorkspace(row: Record<string, unknown>): Workspace {
    return {
      id: row.id as string,
      rootPath: row.root_path as string,
      name: row.name as string,
      gitRemote: (row.git_remote as string | null) ?? undefined,
      createdAt: row.created_at as string,
    };
  }

  upsertSession(workspaceId: string, parsed: ParsedSession): string {
    const sessionKey = `${workspaceId}:${parsed.agent}:${parsed.sessionId}`;
    this.db
      .prepare(
        `INSERT INTO sessions (id, workspace_id, agent, started_at, ended_at, source_path, title, origin_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           started_at = excluded.started_at,
           ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
           source_path = excluded.source_path,
           title = COALESCE(excluded.title, sessions.title),
           origin_kind = excluded.origin_kind`,
      )
      .run(
        sessionKey,
        workspaceId,
        parsed.agent,
        parsed.startedAt,
        parsed.endedAt ?? null,
        parsed.sourcePath,
        parsed.title ?? null,
        parsed.originKind ?? 'real',
      );
    return sessionKey;
  }

  appendEvents(events: RawEvent[]): number {
    if (!events.length) return 0;
    return this.transaction(() => {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO events
         (id, session_id, type, occurred_at, role, text, tool, input_json, output, success, file_path, provenance_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let inserted = 0;
      for (const event of events) {
        const result = stmt.run(
          event.id,
          event.sessionId,
          event.type,
          event.occurredAt,
          event.role ?? null,
          event.text ?? null,
          event.tool ?? null,
          event.input === undefined ? null : JSON.stringify(event.input),
          event.output ?? null,
          event.success === undefined ? null : event.success ? 1 : 0,
          event.filePath ?? null,
          JSON.stringify(event.provenance),
        );
        inserted += Number(result.changes ?? 0);
      }
      return inserted;
    });
  }

  private mapEvent(row: EventRow): RawEvent {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type as RawEvent['type'],
      occurredAt: row.occurred_at,
      role: (row.role as RawEvent['role']) ?? undefined,
      text: row.text ?? undefined,
      tool: row.tool ?? undefined,
      input: parseJson<unknown>(row.input_json, undefined as unknown),
      output: row.output ?? undefined,
      success: row.success === null ? undefined : Boolean(row.success),
      filePath: row.file_path ?? undefined,
      provenance: parseJson(row.provenance_json, {
        agent: 'unknown',
        sourcePath: '',
        lineNo: 0,
        blockIndex: 0,
        occurredAt: row.occurred_at,
      }),
    };
  }

  listEventsForWorkspace(workspaceId: string): RawEvent[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM events e
         JOIN sessions s ON s.id = e.session_id
         WHERE s.workspace_id = ?
         ORDER BY e.occurred_at, e.rowid`,
      )
      .all(workspaceId) as EventRow[];
    return rows.map((row) => this.mapEvent(row));
  }

  listSessions(workspaceId: string): Array<{ id: string; agent: AgentKind; title?: string; startedAt: string }> {
    const rows = this.db
      .prepare('SELECT id, agent, title, started_at FROM sessions WHERE workspace_id = ? ORDER BY started_at')
      .all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      agent: row.agent as AgentKind,
      title: (row.title as string | null) ?? undefined,
      startedAt: row.started_at as string,
    }));
  }

  getSourceCursor(workspaceId: string, sourcePath: string): { size: number; mtimeMs: number } | undefined {
    const row = this.db
      .prepare('SELECT size, mtime_ms FROM source_cursors WHERE workspace_id = ? AND source_path = ?')
      .get(workspaceId, sourcePath) as { size: number; mtime_ms: number } | undefined;
    return row ? { size: Number(row.size), mtimeMs: Number(row.mtime_ms) } : undefined;
  }

  setSourceCursor(workspaceId: string, sourcePath: string, size: number, mtimeMs: number): void {
    this.db
      .prepare(
        `INSERT INTO source_cursors (workspace_id, source_path, size, mtime_ms, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, source_path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, updated_at = excluded.updated_at`,
      )
      .run(workspaceId, sourcePath, size, mtimeMs, NOW());
  }

  recordParseError(sourcePath: string, line: number, message: string): void {
    this.db
      .prepare('INSERT INTO parse_errors (source_path, line_no, message, created_at) VALUES (?, ?, ?, ?)')
      .run(sourcePath, line, message, NOW());
  }

  listParseErrors(): Array<{ sourcePath: string; line: number; message: string }> {
    return (
      this.db.prepare('SELECT source_path, line_no, message FROM parse_errors ORDER BY id').all() as Array<
        Record<string, unknown>
      >
    ).map((row) => ({
      sourcePath: row.source_path as string,
      line: Number(row.line_no),
      message: row.message as string,
    }));
  }

  listCandidates(workspaceId: string, status?: CandidateStatus): Candidate[] {
    const rows = status
      ? (this.db
          .prepare(
            'SELECT * FROM candidates WHERE workspace_id = ? AND status = ? ORDER BY confidence DESC, created_at',
          )
          .all(workspaceId, status) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM candidates WHERE workspace_id = ? ORDER BY confidence DESC, created_at')
          .all(workspaceId) as Record<string, unknown>[]);
    return rows.map((row) => this.mapCandidate(row));
  }

  getCandidate(id: string): Candidate | undefined {
    const row = this.db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCandidate(row) : undefined;
  }

  private mapCandidate(row: Record<string, unknown>): Candidate {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      category: row.category as Candidate['category'],
      statement: row.statement as string,
      confidence: Number(row.confidence),
      status: row.status as CandidateStatus,
      scope: row.scope as Candidate['scope'],
      evidenceEventIds: parseJson<string[]>(row.evidence_ids_json as string, []),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  upsertCandidate(workspaceId: string, draft: CandidateDraft): Candidate {
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM candidates WHERE workspace_id = ? AND category = ? AND statement = ?')
        .get(workspaceId, draft.category, draft.statement) as Record<string, unknown> | undefined;
      if (existing) {
        const evidence = new Set<string>([
          ...parseJson<string[]>(existing.evidence_ids_json as string, []),
          ...draft.evidenceEventIds,
        ]);
        this.db
          .prepare(
            `UPDATE candidates SET confidence = MAX(confidence, ?), evidence_ids_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(draft.confidence, JSON.stringify([...evidence]), NOW(), existing.id as string);
        return this.getCandidate(existing.id as string)!;
      }
      const id = randomUUID();
      const at = NOW();
      this.db
        .prepare(
          `INSERT INTO candidates
           (id, workspace_id, category, statement, confidence, status, scope, evidence_ids_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .run(
          id,
          workspaceId,
          draft.category,
          draft.statement,
          draft.confidence,
          draft.scope,
          JSON.stringify(draft.evidenceEventIds),
          at,
          at,
        );
      return this.getCandidate(id)!;
    });
  }

  setCandidateStatus(id: string, status: CandidateStatus): void {
    this.db.prepare('UPDATE candidates SET status = ?, updated_at = ? WHERE id = ?').run(status, NOW(), id);
    this.audit('reviewer', `candidate.${status}`, id);
  }

  acceptCandidate(candidateId: string, editedStatement?: string): { item: DossierItem; version: DossierVersion } {
    return this.transaction(() => {
      const candidate = this.getCandidate(candidateId);
      if (!candidate) throw new Error(`candidate not found: ${candidateId}`);
      const statement = editedStatement?.trim() || candidate.statement;
      const existing = this.db
        .prepare(
          'SELECT * FROM dossier_items WHERE workspace_id = ? AND category = ? AND statement = ? AND status = ?',
        )
        .get(candidate.workspaceId, candidate.category, statement, 'active') as Record<string, unknown> | undefined;
      let itemId: string;
      let versionNo: number;
      if (existing) {
        itemId = existing.id as string;
        const maxRow = this.db
          .prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM dossier_versions WHERE item_id = ?')
          .get(itemId) as { max_version: number };
        versionNo = Number(maxRow.max_version) + 1;
        this.db.prepare('UPDATE dossier_items SET current_version = ? WHERE id = ?').run(versionNo, itemId);
      } else {
        itemId = randomUUID();
        versionNo = 1;
        this.db
          .prepare(
            `INSERT INTO dossier_items
             (id, workspace_id, category, statement, scope, status, current_version, created_at)
             VALUES (?, ?, ?, ?, ?, 'active', 1, ?)`,
          )
          .run(itemId, candidate.workspaceId, candidate.category, statement, candidate.scope, NOW());
      }
      const versionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO dossier_versions (id, item_id, version_no, content, diff_summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          itemId,
          versionNo,
          statement,
          editedStatement ? '人工改写' : '接受候选',
          NOW(),
        );
      this.db
        .prepare('UPDATE candidates SET status = ?, updated_at = ? WHERE id = ?')
        .run('accepted', NOW(), candidateId);
      this.audit('reviewer', 'candidate.accepted', candidateId, JSON.stringify({ itemId, versionNo }));
      return {
        item: this.getDossierItem(itemId)!,
        version: this.getDossierVersion(versionId)!,
      };
    });
  }

  getDossierItem(id: string): DossierItem | undefined {
    const row = this.db.prepare('SELECT * FROM dossier_items WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapDossierItem(row) : undefined;
  }

  private mapDossierItem(row: Record<string, unknown>): DossierItem {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      category: row.category as DossierItem['category'],
      statement: row.statement as string,
      scope: row.scope as DossierItem['scope'],
      status: row.status as DossierItem['status'],
      currentVersion: Number(row.current_version),
    };
  }

  getDossierVersion(id: string): DossierVersion | undefined {
    const row = this.db.prepare('SELECT * FROM dossier_versions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapDossierVersion(row) : undefined;
  }

  private mapDossierVersion(row: Record<string, unknown>): DossierVersion {
    return {
      id: row.id as string,
      itemId: row.item_id as string,
      versionNo: Number(row.version_no),
      content: row.content as string,
      diffSummary: row.diff_summary as string,
      createdAt: row.created_at as string,
    };
  }

  listDossier(workspaceId: string): DossierItem[] {
    return (
      this.db
        .prepare("SELECT * FROM dossier_items WHERE workspace_id = ? AND status = 'active' ORDER BY category, statement")
        .all(workspaceId) as Record<string, unknown>[]
    ).map((row) => this.mapDossierItem(row));
  }

  listDossierVersions(itemId: string): DossierVersion[] {
    return (
      this.db
        .prepare('SELECT * FROM dossier_versions WHERE item_id = ? ORDER BY version_no')
        .all(itemId) as Record<string, unknown>[]
    ).map((row) => this.mapDossierVersion(row));
  }

  rollbackDossierItem(itemId: string, versionNo: number): DossierItem {
    return this.transaction(() => {
      const version = this.db
        .prepare('SELECT * FROM dossier_versions WHERE item_id = ? AND version_no = ?')
        .get(itemId, versionNo) as Record<string, unknown> | undefined;
      if (!version) throw new Error(`version not found: ${itemId} v${versionNo}`);
      this.db
        .prepare('UPDATE dossier_items SET statement = ?, current_version = ? WHERE id = ?')
        .run(version.content as string, versionNo, itemId);
      this.audit('reviewer', 'dossier.rollback', itemId, JSON.stringify({ versionNo }));
      return this.getDossierItem(itemId)!;
    });
  }

  createTask(input: {
    workspaceId: string;
    title: string;
    goal: string;
    nextStep?: string;
    acceptance?: string;
    ownerAgent?: AgentKind;
  }): Task {
    const id = randomUUID();
    const at = NOW();
    this.db
      .prepare(
        `INSERT INTO tasks
         (id, workspace_id, title, goal, status, owner_agent, next_step, acceptance, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.title,
        input.goal,
        input.ownerAgent ?? null,
        input.nextStep ?? null,
        input.acceptance ?? null,
        at,
        at,
      );
    return this.getTask(id)!;
  }

  getTask(id: string): Task | undefined {
    const row = this.db
      .prepare(
        'SELECT t.*, (SELECT COUNT(*) FROM task_sessions ts WHERE ts.task_id = t.id) AS session_count FROM tasks t WHERE t.id = ?',
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      title: row.title as string,
      goal: row.goal as string,
      status: row.status as Task['status'],
      ownerAgent: (row.owner_agent as AgentKind | null) ?? undefined,
      nextStep: (row.next_step as string | null) ?? undefined,
      acceptance: (row.acceptance as string | null) ?? undefined,
      sessionCount: row.session_count === undefined ? undefined : Number(row.session_count),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  listTasks(workspaceId: string): Task[] {
    return (
      this.db
        .prepare(
          `SELECT t.*, (SELECT COUNT(*) FROM task_sessions ts WHERE ts.task_id = t.id) AS session_count
           FROM tasks t WHERE t.workspace_id = ? ORDER BY t.created_at`,
        )
        .all(workspaceId) as Record<string, unknown>[]
    ).map((row) => this.mapTask(row));
  }

  updateTaskStatus(id: string, status: Task['status']): void {
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, NOW(), id);
    this.audit('reviewer', `task.${status}`, id);
  }

  updateTaskOwner(id: string, agent: AgentKind): void {
    this.db.prepare('UPDATE tasks SET owner_agent = ? WHERE id = ?').run(agent, id);
  }

  listLinkedSessionIds(workspaceId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT ts.session_id FROM task_sessions ts JOIN tasks t ON t.id = ts.task_id WHERE t.workspace_id = ?`,
        )
        .all(workspaceId) as Array<{ session_id: string }>
    ).map((row) => row.session_id);
  }

  linkSession(taskId: string, sessionId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO task_sessions (task_id, session_id, linked_at) VALUES (?, ?, ?)')
      .run(taskId, sessionId, NOW());
  }

  listTaskSessionIds(taskId: string): string[] {
    return (
      this.db.prepare('SELECT session_id FROM task_sessions WHERE task_id = ?').all(taskId) as Array<{
        session_id: string;
      }>
    ).map((row) => row.session_id);
  }

  createHandoff(input: { taskId: string; targetAgent: AgentKind; brief: string; state?: HandoffState }): Handoff {
    const id = randomUUID();
    const at = NOW();
    this.db
      .prepare("UPDATE handoffs SET state = 'Archived', updated_at = ? WHERE task_id = ? AND state = 'Written'")
      .run(at, input.taskId);
    this.db
      .prepare(
        `INSERT INTO handoffs
         (id, task_id, target_agent, state, brief, written_at, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.targetAgent,
        input.state ?? 'Draft',
        input.brief,
        input.state === 'Written' ? at : null,
        at,
        at,
      );
    return this.getHandoff(id)!;
  }

  getHandoff(id: string): Handoff | undefined {
    const row = this.db.prepare('SELECT * FROM handoffs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHandoff(row) : undefined;
  }

  private mapHandoff(row: Record<string, unknown>): Handoff {
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      targetAgent: row.target_agent as AgentKind,
      state: row.state as HandoffState,
      brief: row.brief as string,
      writtenAt: (row.written_at as string | null) ?? undefined,
      claimedAt: (row.claimed_at as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  updateHandoffState(id: string, state: HandoffState): void {
    this.db
      .prepare('UPDATE handoffs SET state = ?, written_at = COALESCE(?, written_at), updated_at = ? WHERE id = ?')
      .run(state, state === 'Written' ? NOW() : null, NOW(), id);
    this.audit('system', `handoff.${state}`, id);
  }

  findOpenHandoff(workspaceId: string, agent: AgentKind): Handoff | undefined {
    const row = this.db
      .prepare(
        `SELECT h.* FROM handoffs h JOIN tasks t ON t.id = h.task_id
         WHERE t.workspace_id = ? AND h.target_agent = ? AND h.state = 'Written'
         ORDER BY h.created_at DESC LIMIT 1`,
      )
      .get(workspaceId, agent) as Record<string, unknown> | undefined;
    return row ? this.mapHandoff(row) : undefined;
  }

  claimHandoff(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE handoffs
         SET state = 'Claimed', claimed_at = ?, updated_at = ?
         WHERE id = ? AND state = 'Written'`,
      )
      .run(NOW(), NOW(), id);
    const claimed = Number(result.changes ?? 0) > 0;
    if (claimed) this.audit('agent', 'handoff.claimed', id);
    return claimed;
  }

  listHandoffs(taskId?: string): Handoff[] {
    const rows = taskId
      ? (this.db.prepare('SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at').all(taskId) as Record<
          string,
          unknown
        >[])
      : (this.db.prepare('SELECT * FROM handoffs ORDER BY created_at').all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapHandoff(row));
  }

  search(workspaceId: string, query: string, limit = 10): Record<string, SearchHit[]> {
    const term = `%${query.trim()}%`;
    const events = (
      this.db
        .prepare(
          `SELECT e.id, e.type, e.text, e.output, e.tool, e.occurred_at, e.session_id, s.agent, s.title
           FROM events e JOIN sessions s ON s.id = e.session_id
           WHERE s.workspace_id = ? AND (e.text LIKE ? OR e.output LIKE ? OR e.tool LIKE ?)
           ORDER BY e.occurred_at DESC LIMIT ?`,
        )
        .all(workspaceId, term, term, term, limit) as Array<Record<string, unknown>>
    ).map((row) => ({
      kind: 'event' as const,
      id: row.id as string,
      title: (row.title as string | null) ?? (row.type as string),
      snippet: String(row.text ?? row.output ?? row.tool ?? '').slice(0, 180),
      meta: `${row.type} · ${row.agent}`,
      sessionId: row.session_id as string,
      agent: row.agent as string,
      occurredAt: row.occurred_at as string,
    }));
    const candidates = (
      this.db
        .prepare(
          `SELECT id, statement, category, status FROM candidates
           WHERE workspace_id = ? AND statement LIKE ? ORDER BY confidence DESC LIMIT ?`,
        )
        .all(workspaceId, term, limit) as Array<Record<string, unknown>>
    ).map((row) => ({
      kind: 'candidate' as const,
      id: row.id as string,
      title: row.statement as string,
      snippet: `候选 · ${row.category} · ${row.status}`,
      meta: '候选',
    }));
    const dossier = (
      this.db
        .prepare(
          `SELECT id, statement, category, scope FROM dossier_items
           WHERE workspace_id = ? AND status = 'active' AND statement LIKE ? LIMIT ?`,
        )
        .all(workspaceId, term, limit) as Array<Record<string, unknown>>
    ).map((row) => ({
      kind: 'dossier' as const,
      id: row.id as string,
      title: row.statement as string,
      snippet: `档案 · ${row.category} · ${row.scope}`,
      meta: '档案',
    }));
    const tasks = (
      this.db
        .prepare(
          `SELECT id, title, goal, status FROM tasks
           WHERE workspace_id = ? AND (title LIKE ? OR goal LIKE ?) LIMIT ?`,
        )
        .all(workspaceId, term, term, limit) as Array<Record<string, unknown>>
    ).map((row) => ({
      kind: 'task' as const,
      id: row.id as string,
      title: row.title as string,
      snippet: String(row.goal ?? ''),
      meta: `任务 · ${row.status}`,
    }));
    return { events, candidates, dossier, tasks };
  }

  sessionIndex(): Array<{
    workspace: Workspace;
    sessions: Array<{
      id: string;
      agent: AgentKind;
      title?: string;
      startedAt: string;
      endedAt?: string;
      originKind?: string;
      events: number;
      failures: number;
    }>;
  }> {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.workspace_id, s.agent, s.title, s.started_at, s.ended_at, s.origin_kind,
                COUNT(e.id) AS event_count,
                COALESCE(SUM(CASE WHEN e.type = 'tool_result' AND e.success = 0 THEN 1 ELSE 0 END), 0) AS failures
         FROM sessions s
         LEFT JOIN events e ON e.session_id = s.id
         GROUP BY s.id
         ORDER BY s.started_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const byWorkspace = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const list = byWorkspace.get(row.workspace_id as string) ?? [];
      list.push(row);
      byWorkspace.set(row.workspace_id as string, list);
    }
    return this.listWorkspaces().map((workspace) => ({
      workspace,
      sessions: (byWorkspace.get(workspace.id) ?? []).map((row) => ({
        id: row.id as string,
        agent: row.agent as AgentKind,
        title: (row.title as string | null) ?? undefined,
        startedAt: row.started_at as string,
        endedAt: (row.ended_at as string | null) ?? undefined,
        originKind: (row.origin_kind as string | null) ?? undefined,
        events: Number(row.event_count ?? 0),
        failures: Number(row.failures ?? 0),
      })),
    }));
  }

  listSessionEvents(sessionId: string, limit = 2000): RawEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY occurred_at, rowid LIMIT ?')
      .all(sessionId, limit) as EventRow[];
    return rows.map((row) => this.mapEvent(row));
  }

  listPromptEvents(sessionId: string, limit = 12): RawEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE session_id = ? AND type = 'prompt'
         ORDER BY occurred_at, rowid LIMIT ?`,
      )
      .all(sessionId, limit) as EventRow[];
    return rows.map((row) => this.mapEvent(row));
  }

  stats(workspaceId: string): Stats {
    const scalar = (sql: string, ...params: Array<string | number>): number => {
      const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      return Number(row?.value ?? 0);
    };
    const sessionsByAgentRows = this.db
      .prepare('SELECT agent, COUNT(*) AS n FROM sessions WHERE workspace_id = ? GROUP BY agent')
      .all(workspaceId) as Array<Record<string, unknown>>;
    const sessionsByAgent: Record<string, number> = {};
    for (const row of sessionsByAgentRows) sessionsByAgent[row.agent as string] = Number(row.n);
    return {
      sessions: scalar('SELECT COUNT(*) AS value FROM sessions WHERE workspace_id = ?', workspaceId),
      events: scalar(
        'SELECT COUNT(*) AS value FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.workspace_id = ?',
        workspaceId,
      ),
      toolCalls: scalar(
        "SELECT COUNT(*) AS value FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.workspace_id = ? AND e.type = 'tool_call'",
        workspaceId,
      ),
      toolFailures: scalar(
        "SELECT COUNT(*) AS value FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.workspace_id = ? AND e.type = 'tool_result' AND e.success = 0",
        workspaceId,
      ),
      corrections: scalar(
        "SELECT COUNT(*) AS value FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.workspace_id = ? AND e.type = 'correction'",
        workspaceId,
      ),
      candidates: scalar('SELECT COUNT(*) AS value FROM candidates WHERE workspace_id = ?', workspaceId),
      dossierItems: scalar(
        "SELECT COUNT(*) AS value FROM dossier_items WHERE workspace_id = ? AND status = 'active'",
        workspaceId,
      ),
      handoffs: scalar(
        'SELECT COUNT(*) AS value FROM handoffs h JOIN tasks t ON t.id = h.task_id WHERE t.workspace_id = ?',
        workspaceId,
      ),
      sessionsByAgent,
    };
  }

  audit(actor: string, action: string, target: string, detail?: string): void {
    this.db
      .prepare('INSERT INTO audit_log (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), actor, action, target, detail ?? null, NOW());
  }

  listAudit(): Array<{ actor: string; action: string; target: string; detail?: string; createdAt: string }> {
    return (
      this.db.prepare('SELECT * FROM audit_log ORDER BY created_at').all() as Array<Record<string, unknown>>
    ).map((row) => ({
      actor: row.actor as string,
      action: row.action as string,
      target: row.target as string,
      detail: (row.detail as string | null) ?? undefined,
      createdAt: row.created_at as string,
    }));
  }
}
