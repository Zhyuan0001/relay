import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AntigravitySummaryAdapter } from '../src/infrastructure/adapters/antigravity.ts';

test('Antigravity summary adapter: decodes workspace URI and nanosecond timestamps', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-ag-'));
  const dbPath = join(root, 'conversation_summaries.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      project_id TEXT,
      agent_name TEXT,
      parent_conversation_id TEXT,
      nesting_depth INTEGER
    )
  `);
  db.prepare(
    `INSERT INTO conversation_summaries
     (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, source, project_id, agent_name, parent_conversation_id, nesting_depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'ag1',
    '环境迁移',
    'preview',
    12,
    '2026-07-09 08:02:37.799741447+00:00',
    JSON.stringify(['file:///home/yuan/%E6%A1%8C%E9%9D%A2/demo']),
    'IDLE',
    'antigravity',
    'p1',
    'self',
    'ag0',
    1,
  );
  db.close();

  const probe = new AntigravitySummaryAdapter().probe(dbPath);
  assert.equal(probe.ok, true);
  assert.equal(probe.format, 'antigravity-summary-sqlite');
  const [session] = new AntigravitySummaryAdapter().parse(dbPath);
  assert.equal(session.agent, 'antigravity');
  assert.equal(session.originKind, 'summary');
  assert.equal(session.title, '环境迁移');
  assert.equal(session.workspacePath, '/home/yuan/桌面/demo');
  assert.ok(session.startedAt.startsWith('2026-07-09T08:02:37.799'));
  assert.equal(session.events[0].type, 'summary');
});
