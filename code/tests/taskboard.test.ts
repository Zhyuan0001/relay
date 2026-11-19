import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.ts';
import { TaskSuggestionService } from '../src/application/task-suggestion-service.ts';
import { ExtractionService } from '../src/application/extraction-service.ts';
import { HandoffService } from '../src/application/handoff-service.ts';
import { normalizeKey } from '../src/domain/rules.ts';

test('normalizeKey merges punctuation and casing variants', () => {
  assert.equal(normalizeKey('使用 pnpm，不要 npm'), normalizeKey('使用PNPM 不要 npm!'));
  assert.notEqual(normalizeKey('使用 pnpm'), normalizeKey('优先使用 pnpm'));
});

test('task suggestions cover every unlinked session and disappear after linking', () => {
  const env = createEnv();
  try {
    const service = new TaskSuggestionService(env.store);
    const suggestions = service.suggest(env.workspace.id);
    assert.ok(suggestions.length >= 1);
    assert.equal(
      suggestions.reduce((sum, item) => sum + item.sessionCount, 0),
      env.store.listSessions(env.workspace.id).length,
    );
    for (const suggestion of suggestions) {
      assert.equal(suggestion.workspaceId, env.workspace.id);
      assert.ok(suggestion.title.length > 0);
      assert.ok(suggestion.confidence >= 0.55 && suggestion.confidence <= 0.92);
      assert.ok(suggestion.sessionIds.length >= 1);
    }

    const first = suggestions[0];
    const task = env.store.createTask({
      workspaceId: env.workspace.id,
      title: first.title,
      goal: first.goal,
    });
    for (const sessionId of first.sessionIds) env.store.linkSession(task.id, sessionId);
    const remaining = service.suggest(env.workspace.id);
    const remainingIds = new Set(remaining.flatMap((item) => item.sessionIds));
    for (const sessionId of first.sessionIds) assert.ok(!remainingIds.has(sessionId));
    assert.equal((env.store.getTask(task.id)?.sessionCount ?? 0), first.sessionCount);
  } finally {
    env.store.close();
  }
});

test('extraction dedupes punctuation variants and task status/claim flow updates owner', () => {
  const env = createEnv();
  try {
    const extraction = new ExtractionService(env.store);
    extraction.extract(env.workspace.id);
    const before = env.store.listCandidates(env.workspace.id, 'pending').length;
    extraction.extract(env.workspace.id);
    const after = env.store.listCandidates(env.workspace.id, 'pending').length;
    assert.equal(after, before);

    const task = env.store.createTask({
      workspaceId: env.workspace.id,
      title: '任务板状态',
      goal: '验证状态流转',
    });
    env.store.updateTaskStatus(task.id, 'blocked');
    assert.equal(env.store.getTask(task.id)?.status, 'blocked');

    const handoff = new HandoffService(env.store);
    const result = handoff.write(task.id, 'antigravity');
    assert.equal(env.store.getTask(task.id)?.ownerAgent, 'antigravity');
    assert.equal(handoff.claim(result.handoff.id), true);
    const claimed = env.store.getTask(task.id);
    assert.equal(claimed?.status, 'in-progress');
    assert.equal(claimed?.ownerAgent, 'antigravity');
  } finally {
    env.store.close();
  }
});