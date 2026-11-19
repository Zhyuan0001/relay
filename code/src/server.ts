import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, watch as watchFs, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from './infrastructure/event-store.ts';
import { QoderAdapter, ClaudeFixtureAdapter, ClaudeCodeAdapter } from './infrastructure/adapters/qoder.ts';
import { CodexAdapter } from './infrastructure/adapters/codex.ts';
import { RooCodeAdapter, ClineAdapter } from './infrastructure/adapters/roo.ts';
import { GeminiAdapter } from './infrastructure/adapters/gemini.ts';
import { DeepSeekHarnessAdapter } from './infrastructure/adapters/deepseek-harness.ts';
import { AiderAdapter } from './infrastructure/adapters/aider.ts';
import { catalog, autoSources } from './infrastructure/adapters/registry.ts';
import { AntigravitySummaryAdapter } from './infrastructure/adapters/antigravity.ts';
import { IngestService } from './application/ingest-service.ts';
import { ExtractionService } from './application/extraction-service.ts';
import { ProjectionService, summarizeProjection } from './application/projection-service.ts';
import { ReviewService } from './application/review-service.ts';
import { HandoffService } from './application/handoff-service.ts';
import { TaskSuggestionService } from './application/task-suggestion-service.ts';
import type { AgentKind, Task } from './domain/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '../fixtures');

export interface RelayServerOptions {
  dbPath: string;
  uiRoot?: string;
  demoRoot?: string;
  fixturesRoot?: string;
  watch?: boolean;
}

export interface RelayServer {
  server: Server;
  store: EventStore;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function expandHome(input: string): string {
  return input.startsWith('~/') ? join(process.env.HOME ?? '', input.slice(2)) : input;
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('RELAY-E004')) return 409;
  if (message.includes('not found')) return 404;
  return 400;
}

export function createRelayServer(options: RelayServerOptions): RelayServer {
  mkdirSync(dirname(options.dbPath), { recursive: true });
  const store = new EventStore(options.dbPath);
  const uiRoot = options.uiRoot ?? resolve(here, 'ui');
  const demoRoot = options.demoRoot ?? join(tmpdir(), 'relay-demos');
  const fixtureBase = options.fixturesRoot ?? fixturesRoot;
  mkdirSync(demoRoot, { recursive: true });
  const review = new ReviewService(store);
  const handoffService = new HandoffService(store);
  const taskSuggestionService = new TaskSuggestionService(store);
  const projectionService = new ProjectionService(store);
  const watchEnabled = options.watch ?? process.env.RELAY_WATCH !== '0';
  const watchers: FSWatcher[] = [];
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let autoRunning = false;

  const claimImported = (
    imported: Array<{ sessionId: string; agent: AgentKind; workspaceId: string; startedAt: string }>,
  ) => {
    const claimed: Array<{ handoffId: string; workspaceId: string; agent: AgentKind }> = [];
    const seen = new Set<string>();
    for (const ref of imported) {
      const key = `${ref.workspaceId}:${ref.agent}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const handoff = store.findOpenHandoff(ref.workspaceId, ref.agent);
      if (!handoff) continue;
      if (handoff.writtenAt && Date.parse(ref.startedAt) < Date.parse(handoff.writtenAt)) continue;
      if (handoffService.claim(handoff.id)) {
        claimed.push({ handoffId: handoff.id, workspaceId: ref.workspaceId, agent: ref.agent });
      }
    }
    return claimed;
  };

  const autoImportAll = (fallbackWorkspaceId?: string) => {
    const ingest = new IngestService(store);
    const imported: Array<{ sessionId: string; agent: AgentKind; workspaceId: string; startedAt: string }> = [];
    const toExtract = new Set<string>();
    const results = autoSources().map((source) => {
      const result = ingest.importAuto(source, fallbackWorkspaceId);
      imported.push(...result.imported);
      for (const group of result.affected) {
        if (group.events > 0) toExtract.add(group.workspaceId);
      }
      return { id: source.id, name: source.name, result };
    });
    const extracted = [...toExtract].map((workspaceId) => ({
      workspaceId,
      result: new ExtractionService(store).extract(workspaceId),
    }));
    return { results, extracted, claimed: claimImported(imported) };
  };

  const scheduleAutoImport = (): void => {
    if (!watchEnabled) return;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (autoRunning) return;
      autoRunning = true;
      try {
        const result = autoImportAll();
        const added = result.results.reduce((sum, item) => sum + item.result.events, 0);
        if (added > 0) console.log(`[relay-watch] imported ${added} events, extracted ${result.extracted.length} workspaces, claimed ${result.claimed.length}`);
      } catch (error) {
        console.error('[relay-watch]', error);
      } finally {
        autoRunning = false;
      }
    }, 2500);
  };

  if (watchEnabled) {
    for (const source of autoSources()) {
      for (const root of source.roots) {
        try {
          watchers.push(watchFs(root, { recursive: true }, scheduleAutoImport));
        } catch {
          // root disappeared or recursive watch unsupported
        }
      }
    }
  }

  const seedDemo = (): Record<string, unknown> => {
    const root = mkdtempSync(join(demoRoot, 'relay-demo-'));
    const qoderRoot = join(root, 'qoder');
    const claudeRoot = join(root, 'claude');
    cpSync(join(fixtureBase, 'qoder'), qoderRoot, { recursive: true });
    cpSync(join(fixtureBase, 'claude'), claudeRoot, { recursive: true });
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), '# 用户原有内容\n\n这段由用户维护，Relay 不应覆盖。\n', 'utf8');
    const ingest = new IngestService(store);
    const workspace = ingest.register(workspaceRoot, `relay-demo-${Date.now()}`);
    ingest.import(workspace.id, [new QoderAdapter()], [qoderRoot]);
    ingest.import(workspace.id, [new ClaudeFixtureAdapter()], [claudeRoot]);
    const extraction = new ExtractionService(store).extract(workspace.id);
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
    return { workspace, task, extraction, stats: store.stats(workspace.id) };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (!pathname.startsWith('/api/')) {
        const relative = pathname === '/' ? '/index.html' : pathname;
        const filePath = resolve(join(uiRoot, relative));
        if (filePath !== uiRoot && !filePath.startsWith(uiRoot + sep)) {
          res.writeHead(403).end('forbidden');
          return;
        }
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(readFileSync(filePath));
        return;
      }

      if (method === 'GET' && pathname === '/api/meta') {
        sendJson(res, 200, {
          name: 'relay',
          version: '0.3.0',
          agents: ['qoder', 'claude-code', 'antigravity'],
          watching: watchEnabled,
        });
        return;
      }
      if (method === 'GET' && pathname === '/api/catalog') {
        sendJson(res, 200, catalog());
        return;
      }
      if (method === 'GET' && pathname === '/api/discover') {
        sendJson(res, 200, catalog().filter((entry) => entry.installed || entry.sources > 0));
        return;
      }
      if (method === 'POST' && pathname === '/api/demo') {
        sendJson(res, 201, seedDemo());
        return;
      }
      if (method === 'GET' && pathname === '/api/workspaces') {
        sendJson(res, 200, store.listWorkspaces());
        return;
      }
      if (method === 'POST' && pathname === '/api/workspaces') {
        const body = await readJson(req);
        const rootPath = String(body.rootPath ?? '').trim();
        if (!rootPath) throw new Error('rootPath is required');
        const workspace = new IngestService(store).register(resolve(expandHome(rootPath)), body.name ? String(body.name) : undefined);
        sendJson(res, 201, workspace);
        return;
      }
      if (method === 'POST' && pathname === '/api/import') {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? '');
        const ingest = new IngestService(store);
        if (body.auto) {
          sendJson(res, 200, autoImportAll(workspaceId || undefined));
          return;
        }
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        const results: unknown[] = [];
        if (body.qoderRoot) results.push({ id: 'qoder', result: ingest.import(workspaceId, [new QoderAdapter()], [resolve(expandHome(String(body.qoderRoot)))]) });
        if (body.claudeRoot) results.push({ id: 'claude-code', result: ingest.import(workspaceId, [new ClaudeCodeAdapter()], [resolve(expandHome(String(body.claudeRoot)))]) });
        if (body.codexRoot) results.push({ id: 'codex', result: ingest.import(workspaceId, [new CodexAdapter()], [resolve(expandHome(String(body.codexRoot)))]) });
        if (body.rooRoot) results.push({ id: 'roo-code', result: ingest.import(workspaceId, [new RooCodeAdapter()], [resolve(expandHome(String(body.rooRoot)))]) });
        if (body.geminiRoot) results.push({ id: 'gemini', result: ingest.import(workspaceId, [new GeminiAdapter()], [resolve(expandHome(String(body.geminiRoot)))]) });
        if (body.dshRoot) results.push({ id: 'deepseek-harness', result: ingest.import(workspaceId, [new DeepSeekHarnessAdapter()], [resolve(expandHome(String(body.dshRoot)))]) });
        if (body.clineRoot) results.push({ id: 'cline', result: ingest.import(workspaceId, [new ClineAdapter()], [resolve(expandHome(String(body.clineRoot)))]) });
        if (body.aiderRoot) results.push({ id: 'aider', result: ingest.import(workspaceId, [new AiderAdapter()], [resolve(expandHome(String(body.aiderRoot)))]) });
        if (body.antigravityRoot) results.push({ id: 'antigravity', result: ingest.import(workspaceId, [new AntigravitySummaryAdapter()], [resolve(expandHome(String(body.antigravityRoot)))]) });
        const imported = results.flatMap((item) => (item as { result: { imported?: Array<{ sessionId: string; agent: AgentKind; workspaceId: string; startedAt: string }> } }).result.imported ?? []);
        sendJson(res, 200, { results, claimed: claimImported(imported) });
        return;
      }
      if (method === 'POST' && pathname === '/api/extract') {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? '');
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        sendJson(res, 200, new ExtractionService(store).extract(workspaceId));
        return;
      }
      if (method === 'GET' && pathname === '/api/inbox') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        sendJson(res, 200, review.inbox(workspaceId));
        return;
      }
      if (method === 'POST' && pathname === '/api/review/accept') {
        const body = await readJson(req);
        const result = review.accept(String(body.candidateId ?? ''), body.editedStatement ? String(body.editedStatement) : undefined);
        sendJson(res, 200, result);
        return;
      }
      if (method === 'POST' && pathname === '/api/review/ignore') {
        const body = await readJson(req);
        review.ignore(String(body.candidateId ?? ''));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === 'GET' && pathname === '/api/dossier') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        sendJson(res, 200, review.dossier(workspaceId));
        return;
      }
      if (method === 'GET' && pathname === '/api/session-index') {
        sendJson(res, 200, store.sessionIndex());
        return;
      }
      if (method === 'GET' && pathname === '/api/session-events') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 2000), 5000);
        sendJson(res, 200, store.listSessionEvents(sessionId, limit));
        return;
      }
      if (method === 'GET' && pathname === '/api/sessions') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        sendJson(res, 200, store.listSessions(workspaceId));
        return;
      }
      if (method === 'GET' && pathname === '/api/events') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000);
        sendJson(res, 200, store.listEventsForWorkspace(workspaceId).slice(-limit).reverse());
        return;
      }
      if (method === 'GET' && pathname === '/api/projections') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        sendJson(res, 200, { plans: projectionService.plan(workspaceId).map(summarizeProjection) });
        return;
      }
      if (method === 'POST' && pathname === '/api/projections/apply') {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? '');
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        const paths = Array.isArray(body.paths) ? body.paths.map(String) : undefined;
        sendJson(res, 200, { results: projectionService.apply(workspaceId, paths) });
        return;
      }
      if (method === 'GET' && pathname === '/api/search') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        const query = url.searchParams.get('q') ?? '';
        if (!query.trim()) {
          sendJson(res, 200, { events: [], candidates: [], dossier: [], tasks: [] });
          return;
        }
        sendJson(res, 200, store.search(workspaceId, query));
        return;
      }
      if (method === 'GET' && pathname === '/api/stats') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        sendJson(res, 200, store.stats(workspaceId));
        return;
      }
      if (method === 'GET' && pathname === '/api/tasks') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        sendJson(res, 200, store.listTasks(workspaceId));
        return;
      }
      if (method === 'GET' && pathname === '/api/task-suggestions') {
        const workspaceId = url.searchParams.get('workspaceId') ?? '';
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        sendJson(res, 200, taskSuggestionService.suggest(workspaceId));
        return;
      }
      if (method === 'POST' && pathname === '/api/tasks/status') {
        const body = await readJson(req);
        const taskId = String(body.taskId ?? '');
        const status = String(body.status ?? '') as Task['status'];
        if (!['open', 'in-progress', 'blocked', 'done'].includes(status)) throw new Error('invalid status');
        if (!store.getTask(taskId)) throw new Error('task not found');
        store.updateTaskStatus(taskId, status);
        sendJson(res, 200, store.getTask(taskId));
        return;
      }
      if (method === 'POST' && pathname === '/api/tasks') {
        const body = await readJson(req);
        const workspaceId = String(body.workspaceId ?? '');
        if (!store.getWorkspace(workspaceId)) throw new Error('workspace not found');
        const task = store.createTask({
          workspaceId,
          title: String(body.title ?? '未命名任务'),
          goal: String(body.goal ?? ''),
          nextStep: body.nextStep ? String(body.nextStep) : undefined,
          acceptance: body.acceptance ? String(body.acceptance) : undefined,
        });
        const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : [];
        for (const sessionId of sessionIds) store.linkSession(task.id, sessionId);
        sendJson(res, 201, store.getTask(task.id) ?? task);
        return;
      }
      if (method === 'POST' && pathname === '/api/tasks/link') {
        const body = await readJson(req);
        const taskId = String(body.taskId ?? '');
        if (!store.getTask(taskId)) throw new Error('task not found');
        const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : [];
        for (const sessionId of sessionIds) store.linkSession(taskId, sessionId);
        sendJson(res, 200, { ok: true, linked: sessionIds.length });
        return;
      }
      if (method === 'POST' && pathname === '/api/handoff') {
        const body = await readJson(req);
        const taskId = String(body.taskId ?? '');
        const targetAgent = String(body.targetAgent ?? 'antigravity') as AgentKind;
        const result = handoffService.write(taskId, targetAgent);
        sendJson(res, 200, result);
        return;
      }
      if (method === 'POST' && pathname === '/api/handoff/claim') {
        const body = await readJson(req);
        sendJson(res, 200, { claimed: handoffService.claim(String(body.handoffId ?? '')) });
        return;
      }
      if (method === 'GET' && pathname === '/api/handoffs') {
        const taskId = url.searchParams.get('taskId') ?? undefined;
        sendJson(res, 200, store.listHandoffs(taskId));
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    server,
    store,
    close: async () => {
      if (autoTimer) clearTimeout(autoTimer);
      for (const watcher of watchers) watcher.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      store.close();
    },
  };
}
