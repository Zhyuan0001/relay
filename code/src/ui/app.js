const CATEGORY_LABELS = {
  command: '命令与包管理',
  style: '命名与风格',
  dependency: '依赖与工具',
  structure: '目录结构',
  testing: '测试',
  docs: '文档与注释',
  language: '语言',
  banned: '禁用项',
  release: '发布流程',
  environment: '环境',
  decision: '决策',
  'failed-attempt': '失败尝试',
  task: '任务',
};

const EVENT_LABELS = {
  prompt: '用户',
  text: 'AI',
  thinking: '思考',
  tool_call: '工具',
  tool_result: '结果',
  edit: '编辑',
  correction: '纠偏',
  summary: '摘要',
  unknown: '未知',
};

const AGENT_LABELS = {
  qoder: 'Qoder',
  'claude-code': 'Claude Code',
  antigravity: 'Antigravity',
  codex: 'Codex',
  'roo-code': 'Roo Code',
  gemini: 'Gemini CLI',
  'deepseek-harness': 'DeepSeek Harness',
  opencode: 'OpenCode',
  cline: 'Cline',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  aider: 'Aider',
  kimi: 'Kimi Code',
  kiro: 'Kiro',
  devin: 'Devin',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  pi: 'Pi',
  minimax: 'MiniMax Code',
  grok: 'Grok',
  generic: '通用 JSONL',
  unknown: '通用',
};

const THEME_KEY = 'relay.theme';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const button = document.querySelector('#theme-btn');
  if (button) button.textContent = theme === 'dark' ? '浅色' : '深色';
}
applyTheme(localStorage.getItem(THEME_KEY) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

const SOURCE_LABELS = {
  real: '真实',
  summary: '摘要',
  generic: '通用',
  planned: '计划',
  'hook-only': '仅 hooks',
};
const ORIGIN_LABELS = {
  real: '真实',
  fixture: '夹具',
  summary: '摘要',
  generic: '通用',
};
const TASK_STATUS_LABELS = {
  open: '待接手',
  'in-progress': '进行中',
  blocked: '阻塞',
  done: '已完成',
};
const TASK_COLUMNS = ['open', 'in-progress', 'blocked', 'done'];
const STATUS_LABELS = {
  ready: '就绪',
  adapter: '可指定',
  summary: '摘要',
  generic: '通用',
  planned: '计划',
  'hook-only': '仅 hooks',
  fixture: '夹具',
  'format-unknown': '格式未知',
  installed: '已安装·未适配',
};

const state = {
  workspaces: [],
  workspaceId: localStorage.getItem('relay.workspaceId') ?? null,
  view: 'overview',
  stats: null,
  sessions: [],
  inbox: [],
  dossier: [],
  tasks: [],
  taskSuggestions: [],
  events: [],
  brief: null,
  handoff: null,
  selectedTaskId: null,
  selectedAgent: 'antigravity',
  catalog: [],
  searchResults: null,
  searchQuery: '',
  selectedSessionId: null,
  selectedSession: null,
  sessionEvents: [],
  sessionIndex: [],
  sessionFilter: 'all',
  projectionPlans: [],
};

const $ = (selector) => document.querySelector(selector);
const viewTitles = {
  overview: ['概览', '跨 agent 的会话、档案与交接'],
  inbox: ['收件箱', '机器生成候选，人工确认后进入档案'],
  timeline: ['会话库', '按工作区浏览已解析的会话，点击进入回合详情'],
  dossier: ['档案', '习惯、环境与任务上下文，版本可回溯'],
  handoff: ['任务与交接', '任务板、启发式任务建议与交接简报'],
  agents: ['Agent 台账', '各 agent 的来源、能力与后续适配计划'],
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category;
}

function agentLabel(agent) {
  return AGENT_LABELS[agent] ?? agent;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

let toastTimer;
function toast(message, type = 'ok') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${type === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 4200);
}

function currentWorkspace() {
  return state.workspaces.find((item) => item.id === state.workspaceId);
}

async function loadWorkspaces() {
  state.workspaces = await api('/api/workspaces');
  if (!state.workspaces.some((item) => item.id === state.workspaceId)) {
    state.workspaceId = state.workspaces[0]?.id ?? null;
  }
  const select = $('#workspace-select');
  select.innerHTML = state.workspaces.length
    ? state.workspaces.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')
    : '<option value="">（暂无工作区）</option>';
  if (state.workspaceId) select.value = state.workspaceId;
  localStorage.setItem('relay.workspaceId', state.workspaceId ?? '');
}

async function refresh() {
  if (!state.workspaceId) {
    state.stats = null;
    state.sessions = [];
    state.inbox = [];
    state.dossier = [];
    state.tasks = [];
    state.taskSuggestions = [];
    state.events = [];
    state.sessionIndex = [];
    state.brief = null;
    render();
    return;
  }
  const id = encodeURIComponent(state.workspaceId);
  const [stats, sessions, inbox, dossier, tasks, events, sessionIndex, catalog] = await Promise.all([
    api(`/api/stats?workspaceId=${id}`),
    api(`/api/sessions?workspaceId=${id}`),
    api(`/api/inbox?workspaceId=${id}`),
    api(`/api/dossier?workspaceId=${id}`),
    api(`/api/tasks?workspaceId=${id}`),
    api(`/api/events?workspaceId=${id}&limit=300`),
    api('/api/session-index'),
    api('/api/catalog'),
  ]);
  state.stats = stats;
  state.sessions = sessions;
  state.inbox = inbox;
  state.dossier = dossier;
  state.tasks = tasks;
  state.events = events;
  state.sessionIndex = sessionIndex;
  state.catalog = catalog;
  if (!state.tasks.some((task) => task.id === state.selectedTaskId)) state.selectedTaskId = state.tasks[0]?.id ?? null;
  $('#inbox-count').textContent = inbox.length ? String(inbox.length) : '';
  render();
}

function render() {
  const workspace = currentWorkspace();
  const title = viewTitles[state.view];
  $('#view-title').textContent = title[0];
  $('#view-sub').textContent = workspace ? `${workspace.name} · ${workspace.rootPath}` : title[1];
  document.querySelectorAll('.nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
  document.querySelectorAll('.view').forEach((section) => section.classList.add('hidden'));
  $(`#view-${state.view}`).classList.remove('hidden');
  if (state.view === 'overview') renderOverview();
  if (state.view === 'inbox') renderInbox();
  if (state.view === 'timeline') renderTimeline();
  if (state.view === 'dossier') renderDossier();
  if (state.view === 'handoff') renderHandoff();
  if (state.view === 'agents') renderAgents();
  if (state.selectedSessionId) renderDrawer();
}

function emptyState(title, detail, action = '') {
  return `<div class="card empty"><b>${esc(title)}</b><p>${esc(detail)}</p>${action}</div>`;
}

function renderOverview() {
  const workspace = currentWorkspace();
  if (!workspace) {
    $('#view-overview').innerHTML = `
      <div class="card empty">
        <b>还没有工作区</b>
        <p>先加载演示数据，或注册一个本地项目目录。</p>
        <div class="row" style="justify-content:center">
          <button class="btn primary" data-action="demo">加载演示数据</button>
        </div>
      </div>
      ${importCard()}
    `;
    return;
  }
  const stats = state.stats ?? {};
  const recent = state.sessions.slice(-5).reverse();
  $('#view-overview').innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${stats.sessions ?? 0}</b><span>会话</span><small>${esc(agentSummary(stats.sessionsByAgent))}</small></div>
      <div class="kpi"><b>${stats.events ?? 0}</b><span>事件</span><small>工具调用 ${stats.toolCalls ?? 0} 次</small></div>
      <div class="kpi"><b>${stats.corrections ?? 0}</b><span>纠偏</span><small>工具失败 ${stats.toolFailures ?? 0} 次</small></div>
      <div class="kpi"><b>${stats.dossierItems ?? 0}</b><span>档案条目</span><small>交接 ${stats.handoffs ?? 0} 次</small></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>最近会话</h2>
        ${recent.length ? `<table><thead><tr><th>来源</th><th>标题</th><th>开始</th></tr></thead><tbody>${recent
          .map(
            (session) => `<tr><td><span class="chip ${session.agent === 'qoder' ? 'command' : 'environment'}">${esc(
              agentLabel(session.agent),
            )}</span></td><td>${esc(session.title ?? '（无标题）')}</td><td class="mono">${fmtTime(session.startedAt)}</td></tr>`,
          )
          .join('')}</tbody></table>` : '<p class="hint">还没有导入会话。</p>'}
        <div class="row" style="margin-top:12px">
          <button class="btn small" data-action="extract">重新提取候选</button>
          <button class="btn small" data-action="nav" data-view="timeline">查看时间线</button>
          <button class="btn small" data-action="nav" data-view="inbox">去审核候选 ${state.inbox.length ? `(${state.inbox.length})` : ''}</button>
        </div>
      </div>
      ${importCard()}
    </div>
  `;
}

function agentSummary(byAgent = {}) {
  const entries = Object.entries(byAgent);
  return entries.length ? entries.map(([agent, count]) => `${agentLabel(agent)} ${count}`).join(' · ') : '尚未导入';
}

function importCard() {
  return `
    <div class="card">
      <h2>接入与导入</h2>
      <p class="hint">日志只读、入库前脱敏。优先扫描本机已安装的 harness；演示数据不会写入真实项目。</p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn primary" data-action="auto-import">扫描并导入已安装 Agent</button>
      </div>
      <div class="field"><label>注册工作区（本地目录）</label>
        <div class="row"><input id="register-path" placeholder="/path/to/project" style="flex:1" />
        <button class="btn" data-action="register">注册</button></div>
      </div>
      <details class="more-roots">
        <summary>手动指定 harness 目录</summary>
        <div class="field"><label>Qoder</label><input id="qoder-root" placeholder="~/.qoder-cn/projects" /></div>
        <div class="field"><label>Claude Code</label><input id="claude-root" placeholder="~/.claude/projects" /></div>
        <div class="field"><label>Codex</label><input id="codex-root" placeholder="~/.codex/sessions" /></div>
        <div class="field"><label>Roo Code</label><input id="roo-root" placeholder=".../rooveterinaryinc.roo-cline/tasks" /></div>
        <div class="field"><label>Gemini CLI</label><input id="gemini-root" placeholder="~/.gemini" /></div>
        <div class="field"><label>DeepSeek Harness</label><input id="dsh-root" placeholder="~/.dsh" /></div>
        <div class="field"><label>Cline</label><input id="cline-root" placeholder=".../saoudrizwan.claude-dev/tasks" /></div>
        <div class="field"><label>Aider</label><input id="aider-root" placeholder="/path/to/repo（含 .aider.chat.history.md）" /></div>
        <div class="field"><label>Antigravity</label><input id="antigravity-root" placeholder="~/.gemini/antigravity" /></div>
        <button class="btn" data-action="import">导入指定目录</button>
      </details>
    </div>
  `;
}

function renderInbox() {
  if (!currentWorkspace()) {
    $('#view-inbox').innerHTML = emptyState('还没有工作区', '先加载演示数据。');
    return;
  }
  if (!state.inbox.length) {
    $('#view-inbox').innerHTML = emptyState('收件箱是空的', '导入会话后点击「重新提取候选」，或所有候选都已处理。');
    return;
  }
  $('#view-inbox').innerHTML = `<div class="card">
    <div class="list-head">
      <h2>待审候选 · ${state.inbox.length}</h2>
      <input class="list-search" data-filter-row="inbox" placeholder="筛选候选（陈述/类别）" aria-label="筛选候选" />
    </div>
    <div>
      ${state.inbox
        .map(
          (candidate) => `
        <div class="candidate" data-filter-item="inbox" data-search="${esc(
          `${candidate.statement} ${categoryLabel(candidate.category)} ${candidate.status}`.toLowerCase(),
        )}">
          <div>
            <div class="row"><span class="chip ${candidate.category}">${esc(categoryLabel(candidate.category))}</span>
              <span class="chip pending">${esc(candidate.status)}</span></div>
            <div class="statement">${esc(candidate.statement)}</div>
            <div class="meta"><span>证据 ${candidate.evidenceEventIds.length} 条</span>
              <span class="conf"><i style="width:${Math.round(candidate.confidence * 100)}%"></i></span>
              <span>置信度 ${(candidate.confidence * 100).toFixed(0)}%</span></div>
          </div>
          <div class="candidate-actions">
            <button class="btn small primary" data-action="accept" data-id="${esc(candidate.id)}" data-statement="${esc(candidate.statement)}">采纳</button>
            <button class="btn small" data-action="edit" data-id="${esc(candidate.id)}" data-statement="${esc(candidate.statement)}">改写</button>
            <button class="btn small ghost" data-action="ignore" data-id="${esc(candidate.id)}">忽略</button>
          </div>
        </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

function eventBody(event) {
  if (event.type === 'tool_call') {
    const command = event.input && typeof event.input === 'object' ? event.input.command : undefined;
    return `<b>${esc(event.tool ?? 'tool')}</b>${command ? ` · <span class="mono">${esc(command)}</span>` : ''}`;
  }
  if (event.type === 'tool_result') {
    return `${event.success === false ? '失败' : '成功'} · ${esc((event.output ?? '').slice(0, 220))}`;
  }
  if (event.type === 'edit') return esc(event.filePath ?? event.text ?? '编辑');
  return esc((event.text ?? event.output ?? '').slice(0, 260));
}

function renderTimeline() {
  const entries = state.sessionIndex;
  if (!entries.length) {
    $('#view-timeline').innerHTML = emptyState('会话库是空的', '导入会话后，这里会按工作区分组展示解析好的会话。');
    return;
  }
  const active = entries.find((entry) => entry.workspace.id === state.workspaceId) ?? entries[0];
  const total = entries.reduce((sum, entry) => sum + entry.sessions.length, 0);
  $('#view-timeline').innerHTML = `<div class="card">
    <div class="list-head"><h2>会话库 · ${entries.length} 个工作区</h2><span class="hint">共 ${total} 个会话，点击进入回合详情</span></div>
    <div class="workspace-grid">${entries
      .map(
        (entry) => `<button class="workspace-card ${entry.workspace.id === active.workspace.id ? 'active' : ''}" data-action="select-workspace" data-id="${esc(entry.workspace.id)}">
          <b>${esc(entry.workspace.name)}</b>
          <span>${entry.sessions.length} 会话</span>
          <div class="session-meta">${esc(entry.workspace.rootPath)}</div>
        </button>`,
      )
      .join('')}</div>
    <div class="list-head" style="margin-top:18px">
      <h3>${esc(active.workspace.name)} · ${active.sessions.length} 会话</h3>
      <input class="list-search" data-filter-row="library" placeholder="筛选会话（标题/agent）" aria-label="筛选会话" />
    </div>
    <div class="session-list">${
      active.sessions.length
        ? active.sessions
            .map(
              (session) => `<div class="session-card" data-action="open-session" data-id="${esc(session.id)}"
                data-filter-item="library" data-search="${esc(
                  `${session.title ?? ''} ${agentLabel(session.agent)} ${session.id}`.toLowerCase(),
                )}">
                <div class="session-main">
                  <div class="row"><span class="chip ${session.agent === 'qoder' ? 'command' : session.agent === 'antigravity' ? 'environment' : 'style'}">${esc(agentLabel(session.agent))}</span>
                    ${session.failures ? `<span class="chip banned">失败 ${session.failures}</span>` : ''}
                    ${session.originKind ? `<span class="chip pending">${esc(ORIGIN_LABELS[session.originKind] ?? session.originKind)}</span>` : ''}</div>
                  <b>${esc(session.title ?? '（无标题会话）')}</b>
                  <div class="session-meta">${fmtTime(session.startedAt)} · ${session.events} 事件 · ${esc(session.id.split(':').slice(-2).join(':'))}</div>
                </div>
                <button class="btn small">打开</button>
              </div>`,
            )
            .join('')
        : '<div class="empty">该工作区还没有会话</div>'
    }</div>
  </div>`;
}

async function openSession(sessionId) {
  const entry = state.sessionIndex.find((item) => item.sessions.some((session) => session.id === sessionId));
  const session = entry?.sessions.find((item) => item.id === sessionId);
  if (!entry || !session) return;
  try {
    const events = await api(`/api/session-events?sessionId=${encodeURIComponent(sessionId)}&limit=3000`);
    state.selectedSessionId = sessionId;
    state.selectedSession = {
      ...session,
      workspaceId: entry.workspace.id,
      workspaceName: entry.workspace.name,
      workspacePath: entry.workspace.rootPath,
    };
    state.sessionEvents = events;
    state.sessionFilter = 'all';
    renderDrawer();
    $('#drawer').classList.remove('hidden');
    document.body.classList.add('drawer-open');
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

function closeDrawer() {
  state.selectedSessionId = null;
  state.selectedSession = null;
  state.sessionEvents = [];
  $('#drawer').classList.add('hidden');
  document.body.classList.remove('drawer-open');
}

function matchesSessionFilter(event, filter) {
  if (filter === 'all') return true;
  if (filter === 'user') return event.type === 'prompt';
  if (filter === 'ai') return event.type === 'text' || event.type === 'thinking';
  if (filter === 'tools') return event.type === 'tool_call' || event.type === 'tool_result';
  if (filter === 'edit') return event.type === 'edit';
  if (filter === 'correction') return event.type === 'correction';
  if (filter === 'failure') return event.type === 'tool_result' && event.success === false;
  return true;
}

function groupTurns(events, filter) {
  const filtered = events.filter((event) => matchesSessionFilter(event, filter));
  const turns = [];
  let current = { prompt: null, events: [] };
  for (const event of filtered) {
    if (event.type === 'prompt') {
      if (current.prompt || current.events.length) turns.push(current);
      current = { prompt: event, events: [] };
    } else {
      current.events.push(event);
    }
  }
  if (current.prompt || current.events.length) turns.push(current);
  return turns;
}

function drawerEvent(event) {
  const label = esc(EVENT_LABELS[event.type] ?? event.type);
  if (event.type === 'tool_call') {
    const command = event.input && typeof event.input === 'object' ? event.input.command : undefined;
    return `<details class="event-details"><summary><span class="chip command">${label}</span> ${esc(event.tool ?? 'tool')}${
      command ? ` · <span class="mono">${esc(command)}</span>` : ''
    }</summary><pre>${esc(JSON.stringify(event.input ?? {}, null, 2))}</pre></details>`;
  }
  if (event.type === 'tool_result') {
    return `<details class="event-details ${event.success === false ? 'failed' : ''}"><summary><span class="chip ${
      event.success === false ? 'banned' : 'command'
    }">${label}</span> ${event.success === false ? '失败' : '成功'}</summary><pre>${esc(event.output ?? '')}</pre></details>`;
  }
  if (event.type === 'edit') {
    return `<div class="event-row"><span class="chip style">${label}</span> <span class="mono">${esc(event.filePath ?? '')}</span></div>`;
  }
  if (event.type === 'correction') {
    return `<div class="event-row correction"><span class="chip banned">${label}</span> ${esc(event.text ?? '')}</div>`;
  }
  return `<div class="event-row"><span class="chip ${event.type === 'prompt' ? 'environment' : 'pending'}">${label}</span> ${esc(
    (event.text ?? event.output ?? '').slice(0, 800),
  )}</div>`;
}

function renderDrawer() {
  const session = state.selectedSession;
  if (!session) return;
  const events = [...state.sessionEvents].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const turns = groupTurns(events, state.sessionFilter);
  const filters = [
    ['all', '全部'],
    ['user', '用户'],
    ['ai', 'AI'],
    ['tools', '工具'],
    ['edit', '编辑'],
    ['correction', '纠偏'],
    ['failure', '失败'],
  ];
  $('#drawer').innerHTML = `<div class="drawer-panel">
    <div class="drawer-head">
      <div>
        <h2>${esc(session.title ?? '未命名会话')}</h2>
        <div class="session-meta">${esc(session.workspaceName)} · ${esc(agentLabel(session.agent))} · ${fmtTime(session.startedAt)} · ${events.length} 事件</div>
      </div>
      <div class="drawer-actions">
        <button class="btn small" data-action="copy-session">复制会话 ID</button>
        <button class="btn small" data-action="copy-workspace">复制工作区</button>
        <button class="btn small" data-action="close-drawer">关闭</button>
      </div>
    </div>
    <div class="filter-chips">${filters
      .map(
        ([key, label]) =>
          `<button class="fchip ${state.sessionFilter === key ? 'on' : ''}" data-action="session-filter" data-filter="${key}">${label}</button>`,
      )
      .join('')}</div>
    <div class="drawer-task">
      <select id="drawer-task" aria-label="关联任务">
        ${state.tasks.length ? state.tasks.map((task) => `<option value="${esc(task.id)}">${esc(task.title)}</option>`).join('') : '<option value="">（暂无任务）</option>'}
      </select>
      <button class="btn small" data-action="link-session-task" ${state.tasks.length ? '' : 'disabled'}>关联到任务</button>
      <button class="btn small primary" data-action="create-task-session">新建任务并关联</button>
      <button class="btn small" data-action="extract-from-session">提炼本工作区候选</button>
      <button class="btn small dark" data-action="handoff-from-session">以此会话发起交接</button>
    </div>
    <div class="drawer-body">${
      turns.length
        ? turns
            .map(
              (turn) => `<div class="turn">
                ${turn.prompt ? `<div class="turn-prompt"><span class="chip environment">用户</span> ${esc(turn.prompt.text ?? '')}</div>` : ''}
                ${turn.events.map(drawerEvent).join('')}
              </div>`,
            )
            .join('')
        : '<div class="empty">该筛选下没有事件</div>'
    }</div>
  </div>`;
}

function renderDossier() {
  if (!state.dossier.length) {
    $('#view-dossier').innerHTML = emptyState('档案还是空的', '先在收件箱采纳几条候选，档案会自动生成版本。');
    return;
  }
  const groups = new Map();
  for (const item of state.dossier) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  $('#view-dossier').innerHTML = `<div class="card">
    <div class="list-head"><h2>项目档案 · ${state.dossier.length} 条</h2>
      <input class="list-search" data-filter-row="dossier" placeholder="筛选档案（陈述/类别）" aria-label="筛选档案" /></div>
    ${[...groups.entries()]
      .map(
        ([category, items]) => `<div class="dossier-group" data-dossier-group>
          <h3>${esc(categoryLabel(category))}</h3>
          ${items
            .map(
              (item) => `<div class="dossier-item" data-filter-item="dossier" data-search="${esc(
                `${item.statement} ${categoryLabel(category)}`.toLowerCase(),
              )}"><span>${esc(item.statement)}</span><small>v${item.currentVersion}</small></div>`,
            )
            .join('')}
        </div>`,
      )
      .join('')}
  </div>
  <div class="card">
    <h2>项目规则投影</h2>
    <p class="hint">把档案写进各 agent 的项目适配文件：AGENTS.md、CLAUDE.md、GEMINI.md、CONVENTIONS.md、.cursor/rules、.clinerules、.roo/rules、.windsurfrules、.qoder/rules、.kiro/steering。受管块写入，块外内容不改。</p>
    <div class="row">
      <button class="btn" data-action="preview-projections">预览投影</button>
      <button class="btn primary" data-action="apply-projections" ${state.projectionPlans.some((plan) => plan.changed && !plan.conflict) ? '' : 'disabled'}>写入全部（跳过冲突）</button>
    </div>
    ${state.projectionPlans.length ? `<div class="matrix-wrap" style="margin-top:12px"><table class="matrix"><thead><tr><th>目标</th><th>Agent</th><th>状态</th><th>变更</th></tr></thead><tbody>${state.projectionPlans
      .map(
        (plan) => `<tr><td class="mono">${esc(plan.path)}</td><td>${esc(plan.harnesses.join(', '))}</td>
          <td><span class="chip ${plan.conflict ? 'banned' : plan.changed ? 'style' : 'pending'}">${plan.conflict ? '冲突' : plan.changed ? (plan.exists ? '更新' : '新建') : '无变化'}</span></td>
          <td>+${plan.additions} / -${plan.deletions}</td></tr>`,
      )
      .join('')}</tbody></table></div>` : ''}
  </div>`;
}

function cap(value) {
  if (value === true) return '<span class="cap yes">有</span>';
  if (value === 'summary') return '<span class="cap warn">摘要</span>';
  if (value === 'planned') return '<span class="cap plan">计划</span>';
  return '<span class="cap no">—</span>';
}

function statusChipClass(status) {
  return (
    {
      ready: 'command',
      summary: 'pending',
      adapter: 'style',
      generic: 'pending',
      'hook-only': 'banned',
      'format-unknown': 'banned',
      installed: 'style',
      planned: 'pending',
    }[status] ?? 'pending'
  );
}

function extractLabel(value) {
  if (value === true) return '完整';
  if (value === 'summary') return '摘要';
  if (value === 'generic') return '通用';
  return '—';
}

function extractChipClass(value) {
  if (value === true) return 'yes';
  if (value === 'summary') return 'warn';
  if (value === 'generic') return 'plan';
  return 'no';
}

function renderAgents() {
  if (!state.catalog.length) {
    $('#view-agents').innerHTML = emptyState('还没有台账', '加载工作区后刷新，或等待演示数据初始化。');
    return;
  }
  $('#view-agents').innerHTML = `<div class="card">
    <div class="list-head"><h2>Agent 台账 · ${state.catalog.length}</h2><span class="hint">检测本机安装、格式/版本探测、提取能力</span></div>
    <div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>Agent</th><th>检测</th><th>提取</th><th>版本 / 格式</th><th>hooks</th><th>MCP</th><th>规则文件</th><th>状态</th></tr></thead>
      <tbody>${state.catalog
        .map(
          (agent) => `<tr>
            <td><b>${esc(agent.name)}</b><div class="mono">${esc(agent.id)}</div>
              <span class="chip ${agent.source === 'real' ? 'command' : agent.source === 'summary' ? 'pending' : agent.source === 'hook-only' ? 'banned' : 'pending'}">${esc(SOURCE_LABELS[agent.source] ?? agent.source)}</span></td>
            <td><span class="cap ${agent.installed ? 'yes' : 'no'}">${agent.installed ? '已安装' : '未安装'}</span>
              <div class="session-meta">${agent.sources} 个源文件</div></td>
            <td><span class="cap ${extractChipClass(agent.capabilities.sessions)}">${esc(extractLabel(agent.capabilities.sessions))}</span></td>
            <td>${
              agent.probe
                ? agent.probe.ok
                  ? `<div class="mono">${agent.probe.version ? `v${esc(agent.probe.version)}` : '版本未知'}</div><div class="session-meta">${esc(agent.probe.format)}</div>`
                  : `<span class="cap no">格式未知</span><div class="session-meta">${esc(agent.probe.detail ?? '')}</div>`
                : '<span class="cap no">—</span>'
            }</td>
            <td>${cap(agent.capabilities.hooks)}</td>
            <td>${cap(agent.capabilities.mcp)}</td>
            <td>${agent.capabilities.rules.map((rule) => `<span class="mono">${esc(rule)}</span>`).join('<br>')}</td>
            <td><span class="chip ${statusChipClass(agent.status)}">${esc(STATUS_LABELS[agent.status] ?? agent.status)}</span></td>
          </tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <p class="hint" style="margin-top:12px">检测：扫描默认目录并探测第一个源的格式/版本；提取：完整 / 摘要 / 通用 / —。计划项只检测安装目录，不解析。台账只读，不修改任何 agent 配置。</p>
  </div>`;
}

function renderHandoff() {
  if (!currentWorkspace()) {
    $('#view-handoff').innerHTML = emptyState('还没有工作区', '先加载演示数据。');
    return;
  }
  const tasks = state.tasks;
  const selected = tasks.find((task) => task.id === state.selectedTaskId) ?? tasks[0];
  const suggestions = state.taskSuggestions;
  const card = (task) => `
    <div class="task-card ${task.id === selected?.id ? 'selected' : ''}" data-action="select-task" data-id="${esc(task.id)}">
      <div class="task-card-head"><b>${esc(task.title)}</b><span class="status-dot ${esc(task.status)}"></span></div>
      <p>${esc(task.goal || '（未填写目标）')}</p>
      <div class="task-card-meta">
        <span>${task.ownerAgent ? esc(agentLabel(task.ownerAgent)) : '未指派'}</span>
        <span>${Number(task.sessionCount ?? 0)} 会话</span>
      </div>
    </div>`;
  $('#view-handoff').innerHTML = `
    <div class="card">
      <div class="list-head">
        <div><h2>任务板</h2><p class="hint">任务状态手动推进；交接写入或认领会自动记录目标 agent。</p></div>
        <div class="row">
          <button class="btn small" data-action="scan-task-suggestions">扫描未关联会话</button>
        </div>
      </div>
      <div class="task-board">
        ${TASK_COLUMNS.map((status) => {
          const items = tasks.filter((task) => task.status === status);
          return `<div class="task-column col-${status}">
            <div class="task-column-head"><span>${TASK_STATUS_LABELS[status]}</span><em>${items.length}</em></div>
            ${items.length ? items.map(card).join('') : '<p class="column-empty">暂无任务</p>'}
          </div>`;
        }).join('')}
      </div>
      ${suggestions.length ? `<div class="suggest-panel">
        <div class="list-head">
          <div><h3>任务建议 · ${suggestions.length}</h3><p class="hint">确定性规则生成：未关联会话、标题归一化合并；不会自动创建，确认后才写入。</p></div>
          <button class="btn small" data-action="clear-task-suggestions">收起</button>
        </div>
        <div class="suggest-list">${suggestions.map((item, index) => `
          <div class="suggest-row">
            <div class="suggest-main">
              <b>${esc(item.title)}</b>
              <span>${item.agents.map((agent) => esc(agentLabel(agent))).join(' / ')} · ${item.sessionCount} 会话 · ${item.events} 事件 · 置信度 ${Math.round(item.confidence * 100)}%</span>
              <p>${esc(item.reason)}</p>
            </div>
            <button class="btn small primary" data-action="accept-task-suggestion" data-index="${index}">创建任务</button>
          </div>`).join('')}</div>
      </div>` : ''}
    </div>
    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <h2>新建任务</h2>
        <p class="hint">也可以先用「扫描未关联会话」从既有会话生成带证据的任务。</p>
        <div class="field"><label>标题</label><input id="task-title" placeholder="例如：实现导入主链路" /></div>
        <div class="field"><label>目标</label><textarea id="task-goal" placeholder="一句话说明要完成什么"></textarea></div>
        <div class="field"><label>下一步</label><input id="task-next" placeholder="接手者先做什么" /></div>
        <div class="field"><label>验收条件</label><input id="task-acceptance" placeholder="怎样算完成" /></div>
        <button class="btn" data-action="create-task">创建任务</button>
      </div>
      <div class="card">
        ${selected ? `
          <div class="task-detail-head">
            <div><h2>${esc(selected.title)}</h2><p class="hint">${esc(selected.goal || '（未填写目标）')}</p></div>
            <span class="status-chip ${esc(selected.status)}">${TASK_STATUS_LABELS[selected.status]}</span>
          </div>
          <div class="task-facts">
            <span>${selected.ownerAgent ? esc(agentLabel(selected.ownerAgent)) : '未指派'}</span>
            <span>${Number(selected.sessionCount ?? 0)} 个关联会话</span>
            <span>更新 ${esc(selected.updatedAt?.slice(0, 16).replace('T', ' ') ?? '')}</span>
          </div>
          ${selected.nextStep ? `<p class="hint"><b>下一步：</b>${esc(selected.nextStep)}</p>` : ''}
          ${selected.acceptance ? `<p class="hint"><b>验收：</b>${esc(selected.acceptance)}</p>` : ''}
          <div class="field"><label>推进状态</label>
            <div class="status-actions">
              ${TASK_COLUMNS.filter((status) => status !== selected.status).map((status) => `
                <button class="btn small" data-action="set-task-status" data-status="${status}">${TASK_STATUS_LABELS[status]}</button>`).join('')}
            </div>
          </div>
          <hr style="border:none;border-top:1px dashed var(--line);margin:14px 0" />
          <div class="field"><label>目标 agent</label>
            <select id="target-agent">
              ${['antigravity', 'claude-code', 'codex', 'qoder'].map((agent) => `<option value="${agent}" ${state.selectedAgent === agent ? 'selected' : ''}>${esc(agentLabel(agent))}</option>`).join('')}
            </select>
          </div>
          <button class="btn primary" data-action="write-handoff">生成并写入交接</button>
          <p class="hint" style="margin-top:8px">写入 AGENTS.md / CLAUDE.md / HANDOFF.md 的受管块；块外内容不改。</p>
        ` : '<h2>任务详情</h2><p class="hint">先创建任务，或在任务板上选择一张卡片。</p>'}
      </div>
    </div>
    ${state.brief ? `<div class="card"><h2>交接简报预览</h2><pre class="brief">${esc(state.brief)}</pre>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-action="copy-brief">复制简报</button>
        <button class="btn small" data-action="claim-handoff" ${state.handoff ? '' : 'disabled'}>标记已认领</button>
        <span class="hint">${state.handoff ? `交接 ${state.handoff.id} · ${state.handoff.state}` : ''}</span>
      </div></div>` : ''}
  `;
}

async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('复制失败，请手动选择文本', 'error');
  }
}

async function runSearch() {
  const input = $('#global-search');
  const query = input.value.trim();
  if (!query) return;
  if (!state.workspaceId) {
    toast('先加载或注册工作区', 'error');
    return;
  }
  const results = await api(`/api/search?workspaceId=${encodeURIComponent(state.workspaceId)}&q=${encodeURIComponent(query)}`);
  state.searchResults = results;
  state.searchQuery = query;
  renderSearchResults();
}

function hideSearch() {
  state.searchResults = null;
  $('#search-results').classList.add('hidden');
}

function renderSearchResults() {
  if (!state.searchResults) return;
  const groups = [
    ['events', '会话事件'],
    ['candidates', '候选'],
    ['dossier', '档案'],
    ['tasks', '任务'],
  ];
  const total = groups.reduce((sum, [key]) => sum + (state.searchResults[key]?.length ?? 0), 0);
  const body = total
    ? groups
        .map(([key, label]) => {
          const hits = state.searchResults[key] ?? [];
          if (!hits.length) return '';
          return `<div class="search-group"><h3>${label} · ${hits.length}</h3>${hits
            .map(
              (hit) => `<button class="search-hit" data-action="goto-result" data-kind="${esc(hit.kind)}" data-id="${esc(hit.id)}" data-session="${esc(hit.sessionId ?? '')}">
                <b>${esc(hit.kind === 'event' ? (hit.meta ?? '事件') : hit.title)}</b>
                <span>${esc(hit.snippet)}</span>
                <small>${hit.kind === 'event' ? `${esc(fmtTime(hit.occurredAt))} · ${esc((hit.sessionId ?? '').split(':').slice(-2).join(':'))}` : esc(hit.meta ?? '')}</small>
              </button>`,
            )
            .join('')}</div>`;
        })
        .join('')
    : '<div class="empty">没有匹配结果</div>';
  $('#search-results').innerHTML = `<div class="card search-card">
    <div class="list-head"><h2>搜索「${esc(state.searchQuery)}」 · ${total}</h2><button class="btn small ghost" data-action="close-search">关闭</button></div>
    ${body}
  </div>`;
  $('#search-results').classList.remove('hidden');
}

async function seedDemo() {
  const result = await api('/api/demo', { method: 'POST' });
  await loadWorkspaces();
  state.workspaceId = result.workspace.id;
  await loadWorkspaces();
  await refresh();
  toast('演示数据已加载');
}

async function onAction(action, element) {
  if (action === 'demo') return seedDemo();
  if (action === 'select-workspace') {
    state.workspaceId = element.dataset.id ?? null;
    localStorage.setItem('relay.workspaceId', state.workspaceId ?? '');
    closeDrawer();
    state.projectionPlans = [];
    await loadWorkspaces();
    await refresh();
    return;
  }
  if (action === 'extract-from-session') {
    if (!state.selectedSession) return;
    const workspaceId = state.selectedSession.workspaceId;
    closeDrawer();
    await api('/api/extract', { method: 'POST', body: JSON.stringify({ workspaceId }) });
    state.view = 'inbox';
    await refresh();
    toast('已从该工作区会话生成候选');
    return;
  }
  if (action === 'preview-projections') {
    if (!state.workspaceId) throw new Error('先加载工作区');
    const result = await api(`/api/projections?workspaceId=${encodeURIComponent(state.workspaceId)}`);
    state.projectionPlans = result.plans;
    renderDossier();
    toast(`已生成 ${result.plans.length} 个投影预览`);
    return;
  }
  if (action === 'apply-projections') {
    if (!state.workspaceId) throw new Error('先加载工作区');
    const paths = state.projectionPlans.filter((plan) => plan.changed && !plan.conflict).map((plan) => plan.path);
    if (!paths.length) throw new Error('没有可写入的变更');
    const result = await api('/api/projections/apply', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: state.workspaceId, paths }),
    });
    state.projectionPlans = [];
    await refresh();
    toast(`已写入 ${result.results.filter((item) => item.changed).length} 个项目文件`);
    return;
  }
  if (action === 'handoff-from-session') {
    if (!state.selectedSession) return;
    const title = state.selectedSession.title ?? '从会话继续';
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: state.selectedSession.workspaceId,
        title,
        goal: title,
        nextStep: '阅读会话详情后继续',
      }),
    });
    await api('/api/tasks/link', {
      method: 'POST',
      body: JSON.stringify({ taskId: task.id, sessionIds: [state.selectedSession.id] }),
    });
    state.selectedTaskId = task.id;
    state.view = 'handoff';
    closeDrawer();
    await refresh();
    toast('任务已创建并关联，确认简报后写入工作区');
    return;
  }
  if (action === 'link-session-task') {
    if (!state.selectedSession) return;
    const taskId = document.querySelector('#drawer-task')?.value;
    if (!taskId) throw new Error('先在交接页创建一个任务');
    await api('/api/tasks/link', {
      method: 'POST',
      body: JSON.stringify({ taskId, sessionIds: [state.selectedSession.id] }),
    });
    toast('已关联到任务');
    await refresh();
    renderDrawer();
    return;
  }
  if (action === 'create-task-session') {
    if (!state.selectedSession) return;
    const title = prompt('任务标题', state.selectedSession.title ?? '从会话创建任务');
    if (!title) return;
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: state.selectedSession.workspaceId,
        title,
        goal: state.selectedSession.title ?? '从该会话继续',
        nextStep: '阅读会话详情后继续',
      }),
    });
    await api('/api/tasks/link', {
      method: 'POST',
      body: JSON.stringify({ taskId: task.id, sessionIds: [state.selectedSession.id] }),
    });
    await refresh();
    renderDrawer();
    toast('任务已创建并关联');
    return;
  }
  if (action === 'open-session') {
    openSession(element.dataset.id);
    return;
  }
  if (action === 'close-drawer') {
    closeDrawer();
    return;
  }
  if (action === 'session-filter') {
    state.sessionFilter = element.dataset.filter ?? 'all';
    renderDrawer();
    return;
  }
  if (action === 'copy-session') {
    await copyText(state.selectedSession?.id ?? '', '会话 ID 已复制');
    return;
  }
  if (action === 'copy-workspace') {
    await copyText(state.selectedSession?.workspacePath ?? currentWorkspace()?.rootPath ?? '', '工作区路径已复制');
    return;
  }
  if (action === 'copy-brief') {
    await copyText(state.brief ?? '', '交接简报已复制');
    return;
  }
  if (action === 'close-search') {
    hideSearch();
    return;
  }
  if (action === 'goto-result') {
    hideSearch();
    const kind = element.dataset.kind;
    if (kind === 'event' && element.dataset.session) {
      openSession(element.dataset.session);
      return;
    }
    if (kind === 'candidate') {
      state.view = 'inbox';
    } else if (kind === 'dossier') {
      state.view = 'dossier';
    } else if (kind === 'task') {
      state.view = 'handoff';
      state.selectedTaskId = element.dataset.id;
    }
    render();
    return;
  }
  if (action === 'nav') {
    hideSearch();
    state.view = element.dataset.view;
    render();
    return;
  }
  if (action === 'register') {
    const rootPath = $('#register-path')?.value?.trim();
    if (!rootPath) throw new Error('填写工作区目录');
    const workspace = await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ rootPath }) });
    await loadWorkspaces();
    state.workspaceId = workspace.id;
    await loadWorkspaces();
    await refresh();
    toast('工作区已注册');
    return;
  }
  if (action === 'extract') {
    if (!state.workspaceId) throw new Error('先注册或加载工作区');
    const result = await api('/api/extract', { method: 'POST', body: JSON.stringify({ workspaceId: state.workspaceId }) });
    await refresh();
    toast(`提取完成：${result.candidates} 个候选`);
    return;
  }
  if (action === 'auto-import') {
    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: state.workspaceId || undefined, auto: true }),
    });
    await loadWorkspaces();
    if (!state.workspaceId && state.workspaces.length) state.workspaceId = state.workspaces[0].id;
    await refresh();
    const totals = (result.results ?? []).reduce(
      (sum, item) => ({
        sessions: sum.sessions + (item.result?.sessions ?? 0),
        events: sum.events + (item.result?.events ?? 0),
      }),
      { sessions: 0, events: 0 },
    );
    const workspaces = new Set(
      (result.results ?? []).flatMap((item) => (item.result?.affected ?? []).map((entry) => entry.workspaceId)),
    );
    const claimed = result.claimed?.length ?? 0;
    toast(`扫描完成：${result.results?.length ?? 0} 个 harness，${workspaces.size} 个工作区，${totals.events} 事件${claimed ? `，自动认领 ${claimed}` : ''}`);
    return;
  }
  if (action === 'import') {
    if (!state.workspaceId) throw new Error('先注册或加载工作区');
    const body = {
      workspaceId: state.workspaceId,
      qoderRoot: $('#qoder-root')?.value?.trim() || undefined,
      claudeRoot: $('#claude-root')?.value?.trim() || undefined,
      codexRoot: $('#codex-root')?.value?.trim() || undefined,
      rooRoot: $('#roo-root')?.value?.trim() || undefined,
      geminiRoot: $('#gemini-root')?.value?.trim() || undefined,
      dshRoot: $('#dsh-root')?.value?.trim() || undefined,
      clineRoot: $('#cline-root')?.value?.trim() || undefined,
      aiderRoot: $('#aider-root')?.value?.trim() || undefined,
      antigravityRoot: $('#antigravity-root')?.value?.trim() || undefined,
    };
    const result = await api('/api/import', { method: 'POST', body: JSON.stringify(body) });
    await api('/api/extract', { method: 'POST', body: JSON.stringify({ workspaceId: state.workspaceId }) });
    await refresh();
    toast(`导入完成：${result.results.map((item) => `${item.sessions} 会话 / ${item.events} 事件`).join('；')}`);
    return;
  }
  if (action === 'accept' || action === 'edit') {
    const id = element.dataset.id;
    let edited;
    if (action === 'edit') {
      const input = prompt('改写后的表述（留空则保持原样）', element.dataset.statement ?? '');
      if (input === null) return;
      edited = input.trim() || undefined;
    }
    await api('/api/review/accept', { method: 'POST', body: JSON.stringify({ candidateId: id, editedStatement: edited }) });
    await refresh();
    toast('已写入档案');
    return;
  }
  if (action === 'ignore') {
    await api('/api/review/ignore', { method: 'POST', body: JSON.stringify({ candidateId: element.dataset.id }) });
    await refresh();
    toast('已忽略');
    return;
  }
  if (action === 'scan-task-suggestions') {
    if (!state.workspaceId) throw new Error('先选择工作区');
    const suggestions = await api(`/api/task-suggestions?workspaceId=${encodeURIComponent(state.workspaceId)}`);
    state.taskSuggestions = suggestions;
    renderHandoff();
    toast(suggestions.length ? `发现 ${suggestions.length} 条任务建议` : '没有未关联任务的会话');
    return;
  }
  if (action === 'clear-task-suggestions') {
    state.taskSuggestions = [];
    renderHandoff();
    return;
  }
  if (action === 'accept-task-suggestion') {
    const suggestion = state.taskSuggestions[Number(element.dataset.index)];
    if (!suggestion) return;
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: suggestion.workspaceId,
        title: suggestion.title,
        goal: suggestion.goal,
        sessionIds: suggestion.sessionIds,
      }),
    });
    state.selectedTaskId = task.id;
    state.taskSuggestions = [];
    state.brief = null;
    state.handoff = null;
    await refresh();
    toast(`任务已创建，关联 ${suggestion.sessionCount} 个会话`);
    return;
  }
  if (action === 'set-task-status') {
    if (!state.selectedTaskId) return;
    const status = element.dataset.status;
    await api('/api/tasks/status', {
      method: 'POST',
      body: JSON.stringify({ taskId: state.selectedTaskId, status }),
    });
    await refresh();
    toast(`任务已标记为「${TASK_STATUS_LABELS[status] ?? status}」`);
    return;
  }
  if (action === 'create-task') {
    const body = {
      workspaceId: state.workspaceId,
      title: $('#task-title')?.value?.trim() || '未命名任务',
      goal: $('#task-goal')?.value?.trim() || '',
      nextStep: $('#task-next')?.value?.trim() || undefined,
      acceptance: $('#task-acceptance')?.value?.trim() || undefined,
    };
    const task = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    state.selectedTaskId = task.id;
    await refresh();
    toast('任务已创建');
    return;
  }
  if (action === 'select-task') {
    state.selectedTaskId = element.dataset.id;
    state.brief = null;
    state.handoff = null;
    render();
    return;
  }
  if (action === 'write-handoff') {
    const agent = $('#target-agent')?.value ?? 'antigravity';
    state.selectedAgent = agent;
    const result = await api('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({ taskId: state.selectedTaskId, targetAgent: agent }),
    });
    state.brief = result.brief;
    state.handoff = result.handoff;
    await refresh();
    renderHandoff();
    toast('已写入工作区交接文件');
    return;
  }
  if (action === 'claim-handoff') {
    if (!state.handoff) return;
    const result = await api('/api/handoff/claim', {
      method: 'POST',
      body: JSON.stringify({ handoffId: state.handoff.id }),
    });
    if (result.claimed) state.handoff = { ...state.handoff, state: 'Claimed' };
    await refresh();
    renderHandoff();
    toast(result.claimed ? '已认领，任务进入进行中' : '该交接已被认领');
    return;
  }
}

document.addEventListener('click', async (event) => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  event.preventDefault();
  try {
    await onAction(element.dataset.action, element);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
});

$('#theme-btn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
$('#refresh-btn').addEventListener('click', async () => {
  try {
    await loadWorkspaces();
    await refresh();
    toast('已刷新');
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
});
$('#demo-btn').addEventListener('click', async () => {
  try {
    await seedDemo();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
});
$('#workspace-select').addEventListener('change', async (event) => {
  state.workspaceId = event.target.value || null;
  localStorage.setItem('relay.workspaceId', state.workspaceId ?? '');
  state.brief = null;
  state.handoff = null;
  state.taskSuggestions = [];
  closeDrawer();
  state.projectionPlans = [];
  try {
    await refresh();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
});
$('#global-search').addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    try {
      await runSearch();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  if (event.key === 'Escape') hideSearch();
});
$('#drawer').addEventListener('click', (event) => {
  if (event.target.id === 'drawer') closeDrawer();
});
document.addEventListener('input', (event) => {
  const input = event.target;
  if (input.matches('.list-search')) {
    const group = input.dataset.filterRow;
    const term = input.value.trim().toLowerCase();
    document.querySelectorAll(`[data-filter-item="${group}"]`).forEach((item) => {
      item.classList.toggle('hidden', Boolean(term) && !(item.dataset.search ?? '').includes(term));
    });
    if (group === 'dossier') {
      document.querySelectorAll('[data-dossier-group]').forEach((node) => {
        const items = [...node.querySelectorAll('[data-filter-item="dossier"]')];
        node.classList.toggle('hidden', items.length > 0 && items.every((item) => item.classList.contains('hidden')));
      });
    }
  }
  if (input.id === 'global-search' && !input.value.trim()) hideSearch();
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) {
    event.preventDefault();
    $('#global-search').focus();
  }
});
document.querySelectorAll('.nav button').forEach((button) => {
  button.addEventListener('click', () => {
    hideSearch();
    state.view = button.dataset.view;
    render();
  });
});

(async () => {
  try {
    await loadWorkspaces();
    await refresh();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
})();
