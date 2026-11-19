import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from '../src/infrastructure/event-store.ts';
import { IngestService, type ImportResult } from '../src/application/ingest-service.ts';
import { QoderAdapter, ClaudeFixtureAdapter } from '../src/infrastructure/adapters/qoder.ts';
import type { Workspace } from '../src/domain/types.ts';

export const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');

export interface TestEnv {
  root: string;
  workspaceRoot: string;
  qoderRoot: string;
  claudeRoot: string;
  store: EventStore;
  workspace: Workspace;
  qoderResult: ImportResult;
  claudeResult: ImportResult;
}

export function createEnv(): TestEnv {
  const root = mkdtempSync(join(tmpdir(), 'relay-test-'));
  const qoderRoot = join(root, 'qoder');
  const claudeRoot = join(root, 'claude');
  cpSync(join(fixturesRoot, 'qoder'), qoderRoot, { recursive: true });
  cpSync(join(fixturesRoot, 'claude'), claudeRoot, { recursive: true });
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, 'AGENTS.md'), '# 用户内容\n\n这段由用户维护，Relay 不应覆盖。\n', 'utf8');
  mkdirSync(join(root, '.relay'), { recursive: true });
  const store = new EventStore(join(root, '.relay', 'relay.db'));
  const ingest = new IngestService(store);
  const workspace = ingest.register(workspaceRoot, 'test');
  const qoderResult = ingest.import(workspace.id, [new QoderAdapter()], [qoderRoot]);
  const claudeResult = ingest.import(workspace.id, [new ClaudeFixtureAdapter()], [claudeRoot]);
  return { root, workspaceRoot, qoderRoot, claudeRoot, store, workspace, qoderResult, claudeResult };
}
