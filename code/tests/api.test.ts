import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createRelayServer } from '../src/server.ts';

test('HTTP API: demo, inbox, dossier, task, handoff, claim, stats', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-api-'));
  const relay = createRelayServer({ dbPath: join(root, 'relay.db'), demoRoot: root, watch: false });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  const port = (relay.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, options?: RequestInit) => {
    const response = await fetch(base + path, {
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    const body = await response.json();
    assert.ok(response.ok, `${path} -> ${response.status}: ${JSON.stringify(body)}`);
    return body as any;
  };

  try {
    const demo = await call('/api/demo', { method: 'POST' });
    const workspaceId = demo.workspace.id as string;
    assert.ok(workspaceId);
    const inbox = await call(`/api/inbox?workspaceId=${workspaceId}`);
    assert.ok(inbox.length > 0);
    await call('/api/review/accept', { method: 'POST', body: JSON.stringify({ candidateId: inbox[0].id }) });
    const dossier = await call(`/api/dossier?workspaceId=${workspaceId}`);
    assert.ok(dossier.length > 0);

    const tasks = await call(`/api/tasks?workspaceId=${workspaceId}`);
    const task = tasks[0];
    const index = await call('/api/session-index');
    assert.ok(index.length >= 1);
    const demoIndex = index.find((entry: any) => entry.workspace.id === workspaceId);
    assert.equal(demoIndex.sessions.length, 3);
    const sessionId = demoIndex.sessions[0].id;
    const sessionEvents = await call(`/api/session-events?sessionId=${encodeURIComponent(sessionId)}`);
    assert.ok(sessionEvents.length > 0);
    const linked = await call('/api/tasks/link', {
      method: 'POST',
      body: JSON.stringify({ taskId: task.id, sessionIds: [sessionId] }),
    });
    assert.equal(linked.linked, 1);
    const suggestions = await call(`/api/task-suggestions?workspaceId=${workspaceId}`);
    assert.ok(Array.isArray(suggestions));
    const extra = await call('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, title: '状态流转', goal: '验证任务板', sessionIds: [sessionId] }),
    });
    assert.equal(extra.sessionCount, 1);
    const blocked = await call('/api/tasks/status', {
      method: 'POST',
      body: JSON.stringify({ taskId: extra.id, status: 'blocked' }),
    });
    assert.equal(blocked.status, 'blocked');
    const handoff = await call('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({ taskId: task.id, targetAgent: 'antigravity' }),
    });
    assert.match(handoff.brief, /交接简报/);
    assert.ok(handoff.files.length >= 2);
    const claimed = await call('/api/handoff/claim', {
      method: 'POST',
      body: JSON.stringify({ handoffId: handoff.handoff.id }),
    });
    assert.equal(claimed.claimed, true);
    const afterClaim = (await call(`/api/tasks?workspaceId=${workspaceId}`)).find(
      (item: any) => item.id === task.id,
    );
    assert.equal(afterClaim.status, 'in-progress');
    assert.equal(afterClaim.ownerAgent, 'antigravity');

    const stats = await call(`/api/stats?workspaceId=${workspaceId}`);
    assert.equal(stats.sessions, 3);

    const search = await call(`/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent('pnpm')}`);
    assert.ok(search.events.length > 0 || search.candidates.length > 0);
    const catalog = await call('/api/catalog');
    assert.ok(catalog.some((agent: any) => agent.id === 'qoder'));
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.match(html, /接力/);
  } finally {
    await relay.close();
  }
});
