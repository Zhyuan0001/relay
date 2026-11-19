import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { QoderAdapter, ClaudeFixtureAdapter } from '../src/infrastructure/adapters/qoder.ts';
import { fixturesRoot } from './helpers.ts';

test('Qoder adapter: block types, tool calls, edits, bad line isolation', () => {
  const adapter = new QoderAdapter();
  const [s1] = adapter.parse(join(fixturesRoot, 'qoder/session-1.jsonl'));
  assert.equal(s1.agent, 'qoder');
  assert.equal(s1.originKind, 'real');
  assert.equal(s1.sessionId, 'q1');
  assert.equal(s1.events.filter((event) => event.type === 'prompt').length, 2);
  assert.equal(s1.events.filter((event) => event.type === 'tool_result').length, 2);
  assert.ok(s1.events.some((event) => event.type === 'tool_call' && event.tool === 'Bash'));
  assert.ok(s1.events.some((event) => event.type === 'edit' && event.filePath?.endsWith('scripts/build.ts')));
  assert.equal(s1.errors.length, 0);

  const [s2] = adapter.parse(join(fixturesRoot, 'qoder/session-2.jsonl'));
  assert.equal(s2.errors.length, 1);
  assert.equal(s2.events.filter((event) => event.type === 'prompt').length, 2);
  assert.equal(s2.events.filter((event) => event.type === 'tool_result' && event.success === false).length, 1);
});

test('Claude fixture adapter: human prompts and tool results', () => {
  const adapter = new ClaudeFixtureAdapter();
  const [session] = adapter.parse(join(fixturesRoot, 'claude/session-1.jsonl'));
  assert.equal(session.agent, 'claude-code');
  assert.equal(session.originKind, 'fixture');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 1);
  assert.equal(session.events.filter((event) => event.type === 'tool_call').length, 1);
  assert.equal(session.events.filter((event) => event.type === 'tool_result').length, 2);
});
