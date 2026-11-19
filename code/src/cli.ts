#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from './infrastructure/event-store.ts';
import { QoderAdapter, ClaudeFixtureAdapter } from './infrastructure/adapters/qoder.ts';
import { AntigravitySummaryAdapter } from './infrastructure/adapters/antigravity.ts';
import { IngestService } from './application/ingest-service.ts';
import { ExtractionService } from './application/extraction-service.ts';
import { ReviewService } from './application/review-service.ts';
import { HandoffService } from './application/handoff-service.ts';
import type { AgentKind } from './domain/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '../fixtures');
const [, , command, ...rest] = process.argv;

function option(name: string, fallback?: string): string | undefined {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : fallback;
}

function openStore(): EventStore {
  const dbPath = resolve(option('db', '.relay/relay.db')!);
  mkdirSync(dirname(dbPath), { recursive: true });
  return new EventStore(dbPath);
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function demo(): void {
  const root = resolve(option('dir') ?? mkdtempSync(join(tmpdir(), 'relay-demo-')));
  const qoderRoot = join(root, 'qoder');
  const claudeRoot = join(root, 'claude');
  const workspaceRoot = join(root, 'workspace');
  cpSync(join(fixturesRoot, 'qoder'), qoderRoot, { recursive: true });
  cpSync(join(fixturesRoot, 'claude'), claudeRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, 'AGENTS.md'), '# 用户原有内容\n\n这段由用户维护，Relay 不应覆盖。\n', 'utf8');

  const dbPath = join(root, '.relay', 'relay.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new EventStore(dbPath);
  const workspace = new IngestService(store).register(workspaceRoot, 'relay-demo');
  const ingest = new IngestService(store);
  const qoderResult = ingest.import(workspace.id, [new QoderAdapter()], [qoderRoot]);
  const claudeResult = ingest.import(workspace.id, [new ClaudeFixtureAdapter()], [claudeRoot]);
  const extraction = new ExtractionService(store).extract(workspace.id);
  const review = new ReviewService(store);
  const inbox = review.inbox(workspace.id);
  const accepted: string[] = [];
  for (const candidate of inbox) {
    review.accept(candidate.id);
    accepted.push(candidate.statement);
  }
  const sessions = store.listSessions(workspace.id);
  const task = store.createTask({
    workspaceId: workspace.id,
    title: '期末项目需求与设计文档',
    goal: '按课程模板完成接力 Relay 需求与设计 v1.0，并准备交接给下一个 agent。',
    nextStep: '按设计实现 P0 主链路：导入 → 提取 → 审核 → 交接。',
    acceptance: '文档与原型通过评审，交接文件可被目标 agent 读取。',
    ownerAgent: 'qoder',
  });
  for (const session of sessions) store.linkSession(task.id, session.id);
  const handoffService = new HandoffService(store);
  const handoff = handoffService.write(task.id, 'antigravity', { workspaceRoot });
  const claimed = handoffService.claim(handoff.handoff.id);
  const stats = store.stats(workspace.id);

  console.log('== Relay demo ==');
  console.log('root:', root);
  console.log('workspace:', workspace.rootPath);
  console.log('import:', { qoder: qoderResult, claude: claudeResult });
  console.log('extract:', extraction);
  console.log('inbox:', inbox.length, 'accepted:', accepted.length);
  for (const statement of accepted) console.log('  +', statement);
  console.log('brief tokens:', Math.ceil(handoff.brief.length / 4));
  console.log('files:', handoff.files.map((plan) => ({ path: plan.path, changed: plan.changed, add: plan.additions, del: plan.deletions })));
  console.log('handoff:', handoff.handoff.id, 'claimed:', claimed);
  console.log('stats:', stats);
  console.log('\n--- brief ---\n' + handoff.brief);
  store.close();
}

function main(): void {
  if (!command || command === 'help') {
    console.log('usage: node src/cli.ts demo [--dir PATH]');
    console.log('       node src/cli.ts import --db DB --workspace DIR --qoder DIR [--claude DIR]');
    console.log('       node src/cli.ts extract --db DB --workspace ID');
    console.log('       node src/cli.ts inbox --db DB --workspace ID');
    console.log('       node src/cli.ts accept --db DB --id CANDIDATE_ID');
    console.log('       node src/cli.ts handoff --db DB --task TASK_ID --agent antigravity');
    console.log('       node src/cli.ts stats --db DB --workspace ID');
    return;
  }

  if (command === 'demo') {
    demo();
    return;
  }

  const store = openStore();
  try {
    if (command === 'import') {
      const workspaceRoot = option('workspace');
      if (!workspaceRoot) throw new Error('--workspace is required');
      const ingest = new IngestService(store);
      const workspace = ingest.register(resolve(workspaceRoot));
      const results = [];
      if (option('qoder')) results.push(ingest.import(workspace.id, [new QoderAdapter()], [resolve(option('qoder')!)]));
      if (option('claude')) results.push(ingest.import(workspace.id, [new ClaudeFixtureAdapter()], [resolve(option('claude')!)]));
      if (option('antigravity')) {
        results.push(ingest.import(workspace.id, [new AntigravitySummaryAdapter()], [resolve(option('antigravity')!)]));
      }
      print({ workspace, results });
      return;
    }
    if (command === 'extract') {
      const workspaceId = option('workspace');
      if (!workspaceId) throw new Error('--workspace is required');
      print(new ExtractionService(store).extract(workspaceId));
      return;
    }
    if (command === 'inbox') {
      const workspaceId = option('workspace');
      if (!workspaceId) throw new Error('--workspace is required');
      print(new ReviewService(store).inbox(workspaceId));
      return;
    }
    if (command === 'accept') {
      const id = option('id');
      if (!id) throw new Error('--id is required');
      print(new ReviewService(store).accept(id));
      return;
    }
    if (command === 'handoff') {
      const taskId = option('task');
      if (!taskId) throw new Error('--task is required');
      const agent = (option('agent', 'antigravity') ?? 'antigravity') as AgentKind;
      const result = new HandoffService(store).write(taskId, agent);
      print({ handoff: result.handoff, files: result.files.map((plan) => plan.path), brief: result.brief });
      return;
    }
    if (command === 'stats') {
      const workspaceId = option('workspace');
      if (!workspaceId) throw new Error('--workspace is required');
      print(store.stats(workspaceId));
      return;
    }
    throw new Error(`unknown command: ${command}`);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
