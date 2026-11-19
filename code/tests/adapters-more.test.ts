import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { RooCodeAdapter, ClineAdapter } from '../src/infrastructure/adapters/roo.ts';
import { AiderAdapter } from '../src/infrastructure/adapters/aider.ts';
import { CodexAdapter } from '../src/infrastructure/adapters/codex.ts';
import { GeminiAdapter } from '../src/infrastructure/adapters/gemini.ts';
import { DeepSeekHarnessAdapter } from '../src/infrastructure/adapters/deepseek-harness.ts';
import { GenericJsonlAdapter } from '../src/infrastructure/adapters/generic.ts';
import { ClaudeCodeAdapter, QoderAdapter } from '../src/infrastructure/adapters/qoder.ts';
import { catalog } from '../src/infrastructure/adapters/registry.ts';
import { fixturesRoot } from './helpers.ts';

test('Roo Code adapter parses task history', () => {
  const [session] = new RooCodeAdapter().parse(join(fixturesRoot, 'roo/tasks/task-1/api_conversation_history.json'));
  assert.equal(session.agent, 'roo-code');
  assert.equal(session.originKind, 'real');
  assert.equal(session.sessionId, 'task-1');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 1);
  assert.ok(session.events.some((event) => event.type === 'tool_call'));
  assert.ok(session.events.some((event) => event.type === 'tool_result'));
});

test('Codex adapter parses rollout JSONL', () => {
  const [session] = new CodexAdapter().parse(join(fixturesRoot, 'codex/session-1.jsonl'));
  assert.equal(session.agent, 'codex');
  assert.equal(session.originKind, 'real');
  assert.equal(session.sessionId, 'cx1');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 1);
  assert.ok(session.events.some((event) => event.type === 'tool_call' && event.tool === 'shell'));
  assert.ok(session.events.some((event) => event.type === 'tool_result'));
});

test('Gemini CLI adapter parses JSON session', () => {
  const [session] = new GeminiAdapter().parse(join(fixturesRoot, 'gemini/session-1.json'));
  assert.equal(session.agent, 'gemini');
  assert.equal(session.originKind, 'real');
  assert.equal(session.sessionId, 'g1');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 1);
  assert.ok(session.events.some((event) => event.type === 'tool_call' && event.tool === 'read_file'));
  assert.ok(session.events.some((event) => event.type === 'tool_result'));
});

test('DeepSeek Harness adapter parses zstd JSONL', () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-dsh-'));
  const path = join(root, 'session.v4.jsonl.zstd');
  const body = [
    JSON.stringify({
      type: 'message',
      sessionId: 'd1',
      timestamp: '2026-11-18T08:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: '继续实现导入。' }] },
    }),
    JSON.stringify({
      type: 'message',
      sessionId: 'd1',
      timestamp: '2026-11-18T08:00:10.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-11-18T08:00:20.000Z',
      payload: { type: 'function_call_output', output: 'ok' },
    }),
  ].join('\n');
  writeFileSync(path, zstdCompressSync(Buffer.from(body)));
  const [session] = new DeepSeekHarnessAdapter().parse(path);
  assert.equal(session.agent, 'deepseek-harness');
  assert.equal(session.originKind, 'real');
  assert.equal(session.sessionId, 'd1');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 1);
  assert.ok(session.events.some((event) => event.type === 'tool_call'));
  assert.ok(session.events.some((event) => event.type === 'tool_result'));
});

test('Claude Code real adapter marks real origin; generic JSONL adapter works', () => {
  const [claude] = new ClaudeCodeAdapter().parse(join(fixturesRoot, 'claude/session-1.jsonl'));
  assert.equal(claude.originKind, 'real');
  const root = mkdtempSync(join(tmpdir(), 'relay-generic-'));
  const path = join(root, 'session.jsonl');
  writeFileSync(
    path,
    `${JSON.stringify({
      sessionId: 'gen1',
      timestamp: '2026-11-18T07:00:00.000Z',
      role: 'user',
      content: [{ type: 'text', text: '继续。' }],
    })}\n`,
  );
  const [generic] = new GenericJsonlAdapter().parse(path);
  assert.equal(generic.agent, 'generic');
  assert.equal(generic.originKind, 'generic');
  assert.ok(generic.events.some((event) => event.type === 'prompt'));

  const jsonPath = join(root, 'session-2.json');
  writeFileSync(
    jsonPath,
    JSON.stringify({
      sessionId: 'gen2',
      cwd: '/tmp/demo',
      messages: [
        { role: 'user', content: '继续。' },
        { role: 'assistant', content: [{ type: 'text', text: '好。' }] },
      ],
    }),
  );
  const [jsonSession] = new GenericJsonlAdapter().parse(jsonPath);
  assert.equal(jsonSession.sessionId, 'gen2');
  assert.ok(jsonSession.events.some((event) => event.type === 'prompt'));
  assert.ok(jsonSession.events.some((event) => event.type === 'text'));
});

test('Cline adapter reuses the Roo task format', () => {
  const [session] = new ClineAdapter().parse(join(fixturesRoot, 'roo/tasks/task-1/api_conversation_history.json'));
  assert.equal(session.agent, 'cline');
  assert.equal(session.originKind, 'real');
  assert.ok(session.events.some((event) => event.type === 'prompt'));
});

test('Aider adapter parses markdown chat history', () => {
  const [session] = new AiderAdapter().parse(join(fixturesRoot, 'aider/.aider.chat.history.md'));
  assert.equal(session.agent, 'aider');
  assert.equal(session.originKind, 'real');
  assert.equal(session.events.filter((event) => event.type === 'prompt').length, 2);
  assert.equal(session.events.filter((event) => event.type === 'text').length, 2);
  assert.match(session.title ?? '', /继续实现导入/);
});

test('adapter probes report format and version without full parsing', () => {
  const qoderProbe = new QoderAdapter().probe(join(fixturesRoot, 'qoder/session-1.jsonl'));
  assert.equal(qoderProbe.ok, true);
  assert.equal(qoderProbe.format, 'qoder-jsonl');
  const rooProbe = new RooCodeAdapter().probe(join(fixturesRoot, 'roo/tasks/task-1/api_conversation_history.json'));
  assert.equal(rooProbe.ok, true);
  assert.equal(rooProbe.format, 'roo-task-history');

  const root = mkdtempSync(join(tmpdir(), 'relay-probe-'));
  const path = join(root, 'session.v4.jsonl.zstd');
  writeFileSync(
    path,
    zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', version: 4, id: 'probe-1', cwd: '/tmp/demo' }))),
  );
  const dshProbe = new DeepSeekHarnessAdapter().probe(path);
  assert.equal(dshProbe.ok, true);
  assert.equal(dshProbe.format, 'dsh-session-v4');
  assert.equal(dshProbe.version, '4');
});

test('catalog covers mainstream harnesses', () => {
  const items = catalog();
  const ids = new Set(items.map((item) => item.id));
  assert.ok(items.length >= 18);
  assert.ok(items.every((item) => typeof item.installed === 'boolean' && typeof item.sources === 'number'));
  assert.ok(items.filter((item) => !['cursor', 'devin'].includes(item.id)).every((item) => item.adapter === true));
  assert.equal(items.find((item) => item.id === 'devin')?.adapter, false);
  for (const id of ['qoder', 'claude-code', 'codex', 'antigravity', 'roo-code', 'cline', 'gemini', 'deepseek-harness', 'cursor', 'windsurf', 'aider', 'kimi']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});
