export type AgentKind =
  | 'qoder'
  | 'claude-code'
  | 'antigravity'
  | 'codex'
  | 'roo-code'
  | 'gemini'
  | 'deepseek-harness'
  | 'opencode'
  | 'cline'
  | 'cursor'
  | 'windsurf'
  | 'aider'
  | 'kimi'
  | 'kiro'
  | 'devin'
  | 'openclaw'
  | 'hermes'
  | 'pi'
  | 'minimax'
  | 'grok'
  | 'generic'
  | 'unknown';

export type EventType =
  | 'prompt'
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'edit'
  | 'correction'
  | 'summary'
  | 'unknown';

export type Role = 'user' | 'assistant' | 'tool' | 'system';

export type CandidateCategory =
  | 'command'
  | 'style'
  | 'dependency'
  | 'structure'
  | 'testing'
  | 'docs'
  | 'language'
  | 'banned'
  | 'release'
  | 'environment'
  | 'decision'
  | 'failed-attempt'
  | 'task';

export type CandidateStatus = 'pending' | 'accepted' | 'ignored' | 'conflict';

export type Scope = 'project' | 'global';

export type HandoffState =
  | 'Draft'
  | 'Previewed'
  | 'Written'
  | 'Claimed'
  | 'Acknowledged'
  | 'Outcome'
  | 'Archived';

export interface Provenance {
  agent: AgentKind;
  sourcePath: string;
  lineNo: number;
  blockIndex: number;
  occurredAt: string;
}

export interface RawEvent {
  id: string;
  sessionId: string;
  type: EventType;
  occurredAt: string;
  role?: Role;
  text?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  success?: boolean;
  filePath?: string;
  provenance: Provenance;
}

export interface ParseError {
  line: number;
  message: string;
  sample?: string;
}

export interface ParsedSession {
  agent: AgentKind;
  sessionId: string;
  workspacePath?: string;
  startedAt: string;
  endedAt?: string;
  title?: string;
  sourcePath: string;
  originKind?: 'real' | 'fixture' | 'summary' | 'generic';
  events: RawEvent[];
  errors: ParseError[];
}

export interface Workspace {
  id: string;
  rootPath: string;
  name: string;
  gitRemote?: string;
  createdAt: string;
}

export interface Candidate {
  id: string;
  workspaceId: string;
  category: CandidateCategory;
  statement: string;
  confidence: number;
  status: CandidateStatus;
  scope: Scope;
  evidenceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DossierItem {
  id: string;
  workspaceId: string;
  category: CandidateCategory;
  statement: string;
  scope: Scope;
  status: 'active' | 'archived';
  currentVersion: number;
}

export interface DossierVersion {
  id: string;
  itemId: string;
  versionNo: number;
  content: string;
  diffSummary: string;
  createdAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  status: 'open' | 'in-progress' | 'blocked' | 'done';
  ownerAgent?: AgentKind;
  nextStep?: string;
  acceptance?: string;
  sessionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Handoff {
  id: string;
  taskId: string;
  targetAgent: AgentKind;
  state: HandoffState;
  brief: string;
  writtenAt?: string;
  claimedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterProbe {
  format: string;
  version?: string;
  ok: boolean;
  detail?: string;
}

export interface LogAdapter {
  id: AgentKind;
  discover(root: string): string[];
  parse(path: string): ParsedSession[];
  probe?(path: string): AdapterProbe;
}

export interface CandidateDraft {
  category: CandidateCategory;
  statement: string;
  confidence: number;
  scope: Scope;
  evidenceEventIds: string[];
}

export interface Stats {
  sessions: number;
  events: number;
  toolCalls: number;
  toolFailures: number;
  corrections: number;
  candidates: number;
  dossierItems: number;
  handoffs: number;
  sessionsByAgent: Record<string, number>;
}


export interface SearchHit {
  kind: 'event' | 'candidate' | 'dossier' | 'task';
  id: string;
  title: string;
  snippet: string;
  meta?: string;
  sessionId?: string;
  agent?: string;
  occurredAt?: string;
}
