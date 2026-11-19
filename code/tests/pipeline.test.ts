import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createEnv } from './helpers.ts';
import { ExtractionService } from '../src/application/extraction-service.ts';
import { QoderAdapter } from '../src/infrastructure/adapters/qoder.ts';
import { IngestService } from '../src/application/ingest-service.ts';

test('pipeline: import, extract, stats, and idempotent re-import', () => {
  const env = createEnv();
  try {
    const result = new ExtractionService(env.store).extract(env.workspace.id);
    assert.ok(result.corrections >= 3);
    const candidates = env.store.listCandidates(env.workspace.id);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some((item) => /pnpm/i.test(item.statement)));
    assert.ok(candidates.some((item) => item.statement.includes('使用 pnpm')));
    assert.ok(candidates.some((item) => item.statement.includes('不要使用 npm')));
    assert.ok(!candidates.some((item) => item.statement.includes('帮我修复')));
    assert.ok(candidates.some((item) => item.category === 'structure' && item.statement.includes('docs/')));
    assert.ok(candidates.some((item) => item.status === 'conflict'), 'npm/pnpm conflict should be marked');
    assert.ok(env.store.listCandidates(env.workspace.id, 'pending').length > 0);

    const stats = env.store.stats(env.workspace.id);
    assert.equal(stats.sessions, 3);
    assert.ok(stats.toolCalls >= 6);
    assert.equal(stats.toolFailures, 1);
    assert.ok(stats.corrections >= 3);

    const again = new IngestService(env.store).import(env.workspace.id, [new QoderAdapter()], [join(env.root, 'qoder')]);
    assert.equal(again.events, 0);
    assert.ok(again.skipped >= 2);

    const secondRoot = join(env.root, 'workspace2');
    mkdirSync(secondRoot, { recursive: true });
    const secondWorkspace = new IngestService(env.store).register(secondRoot, 'second');
    const secondImport = new IngestService(env.store).import(secondWorkspace.id, [new QoderAdapter()], [join(env.root, 'qoder')]);
    assert.ok(secondImport.events > 0, 'same source must import into a second workspace');
  } finally {
    env.store.close();
  }
});


test('auto import routes sessions to their workspacePath', () => {
  const env = createEnv();
  try {
    const result = new IngestService(env.store).importAuto({ adapter: new QoderAdapter(), roots: [env.qoderRoot] });
    assert.ok(result.sessions >= 2);
    assert.ok(result.imported.every((item) => item.workspaceId !== env.workspace.id));
    const workspace = env.store.getWorkspaceByPath('/tmp/relay-demo');
    assert.ok(workspace);
    assert.equal(result.affected[0].workspaceId, workspace.id);
    assert.ok(result.affected[0].events > 0);
  } finally {
    env.store.close();
  }
});
