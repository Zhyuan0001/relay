# 1 引言

## 1.1 编写目的

本文档给出「接力（Relay）· 跨 Agent 的项目记忆与交接工作台」v1.0 的软件设计模型，作为编码实现、测试与验收的依据。

预期读者包括：课程指导教师、项目开发者、测试人员以及后续维护者。本文档说明系统如何实现《软件需求规约》中的功能与非功能需求，重点描述体系结构、逻辑视图、用例实现、实现视图、进程视图和部署视图；不重复需求文档中的业务背景与验收清单。

## 1.2 适用范围

本文档适用于 Relay v1.0 本地单机桌面应用，覆盖工作区接入、会话导入与事件建模、习惯/环境/任务提取、人工审核、档案版本、交接简报与写入、Agent 台账、任务派工与使用统计。本文档与《软件需求规约》v1.0 配套使用；设计中的类名、接口名、表名与受管块标记是实现阶段的不变量，如需变更应同步更新本文档和测试文档。

本文档不覆盖：云端多用户、ACP/MCP/A2A 协议实现、agent 运行时控制、代码语义分析、自动修改 agent 配置。

## 1.3 定义

[[TABLE:表 1-1 设计术语]]
| 术语/缩写 | 定义 |
|---|---|
| 观察者模式 | 本系统不启动、不控制 agent，只读取其日志并写入工作区文件。 |
| 事件溯源 | 以 append-only 事件日志为事实来源，派生出摘要与档案视图。 |
| 适配器 | 把某一种 agent 日志格式转换为统一事件的插件。 |
| 受管块 | 由本系统维护、用固定标记包围的文件片段；标记外内容不被修改。 |
| 投影 | 把规范化内容翻译为目标 agent 的原生格式（文件或简报）。 |
| Agent 台账 | 各 agent 的安装状态、日志格式、hooks/MCP/skills 位置与能力矩阵。 |
| 兼容矩阵 | 描述各 agent 能否读取 AGENTS.md/CLAUDE.md、是否支持 hooks/MCP、能否续跑会话。 |
| 任务（Task） | 工作区内具有目标、状态、owner 与验收条件的工作单元。 |
| claim-once | 一条交接记录只被认领一次，避免重复消费。 |
| 单写者 | 所有数据库写入经由一个串行写者，避免并发写冲突。 |
| 原子写 | 先写临时文件，再 rename 覆盖；失败时保留原文件。 |
| 不可信内容 | 从日志或会话中提取、可能包含注入指令的文本；注入时必须加分隔与标记。 |
| P0 / P1 | P0 为 v1.0 必须实现；P1 为进度允许时实现并可裁剪。 |
| IPC | Electron 主进程与渲染进程之间的进程间通信。 |

## 1.4 参考资料

[[TABLE:表 1-2 参考资料]]
| 编号 | 标题 | 版本/日期 | 来源 |
|---|---|---|---|
| D-01 | 《软件需求规约-接力》 | v1.0，2026-11-20 | 本项目文档 |
| D-02 | 《软件设计模型》课程模板 | 2026 | 课程附件 |
| D-03 | 第七讲《软件需求分析》课件 | 2026 | 课程资料 |
| D-04 | 第八讲《软件设计》课件 | 2026 | 课程资料 |
| D-05 | Agent Client Protocol 官方文档 | 2026 访问 | https://agentclientprotocol.com/ |
| D-06 | AGENTS.md 约定 | 2026 访问 | https://agents.md/ |
| D-07 | ai-memory 架构文档 | 2026 访问 | https://github.com/akitaonrails/ai-memory |
| D-08 | projectmem 项目主页 | 2026 访问 | https://github.com/riponcm/projectmem |
| D-09 | claude-mem 项目主页 | 2026 访问 | https://github.com/thedotmack/claude-mem |
| D-10 | CC Switch 项目主页 | 2026 访问 | https://github.com/farion1231/cc-switch |
| D-11 | Electron 文档 | 2026 访问 | https://www.electronjs.org/docs |
| D-12 | Vue 3 文档 | 2026 访问 | https://vuejs.org/ |
| D-13 | better-sqlite3 文档 | 2026 访问 | https://github.com/WiseLibs/better-sqlite3 |
| D-14 | ISO/IEC 25010:2011 系统与软件质量模型 | 2011 | ISO/IEC |

## 1.5 概述

本文档按 UML 多视图组织：第 2 章给出用例视图与活动图；第 3 章给出逻辑视图，包括包图、领域/应用/基础设施/界面类图、9 个用例的顺序图、设计类图与状态图；第 4 章给出实现视图；第 5 章给出进程视图；第 6 章给出部署视图；第 7 章记录关键设计决策与权衡；第 8、9 章分别给出数据设计与接口设计；附录给出追踪矩阵、类清单、设计不变量与竞品实现对照。

# 2 用例视图

## 2.1 用例图

系统有 14 个用例（详见《软件需求规约》表 3-11）。图 2-1 给出与架构关系最密切的主用例：导入与刷新、审核候选、档案版本、生成交接、写入与注入、任务派工。

[[FIG:../build/diagrams/use-case-relay.png|图 2-1 接力主用例图|11.5]]

设计关注两条链：**接入链**（UC-02 → UC-04 → UC-05）与**交接链**（UC-14 → UC-07 → UC-08 → UC-09）。接入链产出可信档案，交接链把档案转化为下一个 agent 可读的上下文。

## 2.2 活动图

### 2.2.1 导入与提取

[[FIG:../build/diagrams/activity-import.png|图 2-2 导入与提取活动图|11]]

导入必须先脱敏再入库；解析失败不能中断整批；未知格式标记为未知来源，不静默丢失。

### 2.2.2 交接与写入

[[FIG:../build/diagrams/activity-handoff.png|图 2-3 交接与写入活动图|11]]

交接写入以用户确认为前提；受管块冲突必须显式处理；写入采用原子替换；写入后进入 claim 流程。

### 2.2.3 候选提取

[[FIG:../build/diagrams/activity-extract.png|图 2-4 候选提取活动图|11]]

提取采用「规则族 → 候选 → 去重/冲突 → 待审」的流水线；提取不直接改档案，所有变更经审核进入版本。

# 3 逻辑视图

## 3.1 系统结构

### 3.1.1 架构风格与分层

系统采用**分层 + 端口适配器**结构，共五层：

[[TABLE:表 3-1 分层与职责]]
| 层 | 职责 | 依赖方向 |
|---|---|---|
| ui（Vue3） | 工作台界面、任务板、审核、档案、统计 | 只依赖 application 的 IPC 契约 |
| application | 用例编排：导入、提取、审核、交接、派工、统计 | 依赖 domain 与 ports |
| domain | 实体、值对象、不变量、状态机 | 不依赖外部技术 |
| ports | 仓储、适配器、写入器、脱敏器等接口 | 被 application 使用，被 infrastructure 实现 |
| infrastructure | SQLite、日志适配器、受管块写入、文件系统、git | 实现 ports，依赖 domain |

补充两条架构约束：

- **观察者约束**：系统不启动或控制 agent；唯一对外副作用是工作区文件的受管块写入。
- **单写者约束**：数据库写入全部经由一个串行写者；渲染进程不直接访问数据库。

### 3.1.2 包图

[[FIG:../build/diagrams/package.png|图 3-1 系统包图|16]]

### 3.1.3 领域模型类图

[[FIG:../build/diagrams/class-domain.png|图 3-2 领域模型类图|11]]

[[PAGEBREAK]]

领域模型的核心不变量：

[[TABLE:表 3-2 领域不变量]]
| 编号 | 不变量 | 说明 |
|---|---|---|
| INV-01 | 事件不可变 | Event 只追加，不更新；纠错以新事件表达。 |
| INV-02 | 证据可定位 | 每条 Evidence 必须指向源文件、行号与会话。 |
| INV-03 | 候选不入档 | Candidate 必须经审核才能生成 DossierItem。 |
| INV-04 | 版本只追加 | DossierVersion 不覆盖历史，只新增版本。 |
| INV-05 | 交接有主 | 每个 Handoff 必须绑定一个 Task 与目标 agent。 |
| INV-06 | 认领一次 | 同一 Handoff 只能从 Written 进入 Claimed 一次。 |
| INV-07 | 作用域明确 | 档案条目必须标注全局或项目作用域。 |

### 3.1.4 应用服务类图

[[FIG:../build/diagrams/class-application.png|图 3-3 应用服务类图|16]]

应用服务按用例组织，彼此通过领域服务与端口协作，不直接依赖 infrastructure。`HandoffService` 是交接链的编排者；`CatalogService` 为派工提供 agent 能力；`ExportService` 负责写入与复制。

### 3.1.5 基础设施类图

[[FIG:../build/diagrams/class-infrastructure.png|图 3-4 基础设施类图|16]]

基础设施层包含三类适配：日志适配器注册表、SQLite 存储、受管块写入器。具体实现包括 `QoderJsonlAdapter`、`AntigravitySummaryAdapter`、`ClaudeFixtureAdapter`、`SqliteStore`、`ManagedBlockWriter`、`RegexRedactor`、`FileWatcher` 与 `GitIdentityProvider`；图中为保持可读性做了归并。

### 3.1.6 界面类图

[[FIG:../build/diagrams/class-ui.png|图 3-5 界面类图|14]]

界面采用「视图 → Store → IPC Client」的单向数据流。视图不直接访问文件系统；所有写操作都通过 application 的用例接口。

## 3.2 Use-Case 实现

以下顺序图给出关键用例的对象协作；参与者缩写：UI 为渲染进程视图，DB 为 SQLite。

### 3.2.1 UC-02 导入与刷新会话

[[FIG:../build/diagrams/seq-import.png|图 3-6 UC-02 导入与刷新会话|16]]

要点：

- 解析以「来源 + 游标」为单位，支持增量与重复导入幂等；
- 脱敏在写入事件库之前完成，原始日志不被复制；
- 单个来源失败不影响其他来源；坏行记录到 `parse_errors`。

### 3.2.2 UC-04 生成候选

[[FIG:../build/diagrams/seq-extract.png|图 3-7 UC-04 生成候选|16]]

要点：

- 规则族按类别执行：纠偏、习惯、环境、任务；
- 每个候选携带证据列表与置信度；
- 语义去重与冲突检测在写库前完成，冲突候选保留并标记。

### 3.2.3 UC-05 审核候选

[[FIG:../build/diagrams/seq-review.png|图 3-8 UC-05 审核候选|16]]

要点：

- 审核动作是档案变更的唯一入口；
- 接受/改写/合并生成新的 DossierVersion；
- 审核记录写入审计日志，支持追溯。

### 3.2.4 UC-07 生成交接简报

[[FIG:../build/diagrams/seq-handoff.png|图 3-9 UC-07 生成交接简报|16]]

要点：

- 简报由「任务 + 已接受规则 + 失败尝试 + 环境 + 文件热点」组装；
- 预算为 1,500 token / 120 行，超出时按优先级裁剪；
- 生成后进入 Draft，允许人工编辑。

### 3.2.5 UC-08 写入与注入

[[FIG:../build/diagrams/seq-write.png|图 3-10 UC-08 写入与注入|16]]

要点：

- 先读取现有文件并计算受管块 diff，用户确认后才写入；
- 受管块外内容原样保留；块内哈希不一致时提示冲突；
- 原子写：临时文件 + rename；失败时原文件不变；
- 连续两次写入相同档案不改变文件内容（幂等）。

### 3.2.6 UC-14 创建任务并派工

[[FIG:../build/diagrams/seq-dispatch.png|图 3-11 UC-14 创建任务并派工|16]]

要点：

- 任务板是交接的入口；任务包含目标、状态、owner、验收条件；
- 目标 agent 的能力来自台账与兼容矩阵，决定注入方式；
- 派工记录 Claim，并返回启动命令；系统不控制 agent 运行时。

### 3.2.7 UC-09 认领交接

[[FIG:../build/diagrams/seq-claim.png|图 3-12 UC-09 认领交接|16]]

要点：

- 认领优先由工作区新会话事件触发，无法检测时提供手工按钮；
- claim-once：已认领的交接不再重复消费；
- 认领结果通知界面，并写入交接历史。

### 3.2.8 UC-10 查看统计

[[FIG:../build/diagrams/seq-stats.png|图 3-13 UC-10 查看统计|16]]

要点：

- 指标全部由事件库聚合，不做估算；
- 查询按工作区、agent、时间范围过滤；
- 统计页标注数据来源与刷新时间。

### 3.2.9 UC-13 管理 Agent 台账

[[FIG:../build/diagrams/seq-catalog.png|图 3-14 UC-13 管理 Agent 台账|16]]

要点：

- 台账只读扫描日志目录、配置、skills/MCP 位置与版本；
- 兼容矩阵驱动注入方式与派工选择；
- 资产只索引与标记 drift，不自动安装、不执行 hook。

### 3.2.10 可用性增强的实现映射

以下需求复用既有领域与服务，不新增独立子系统；界面新增浮层与面板，均挂在 AppShell 下。

[[TABLE:表 3-3 可用性增强的实现映射]]
| 需求 | 实现位置 | 说明 |
|---|---|---|
| FR-24 实时采集 | infrastructure/HookEventReceiver（P1） | 本地 HTTP 接收 hook 事件，复用脱敏与事件入库；默认关闭 |
| FR-25 全局搜索 | application/SearchService + FTS5 | 聚合事件、候选、档案、交接的全文检索；IPC search.query |
| FR-26 首次引导 | ui/OnboardingView + DemoDataService | 三步引导；演示夹具工作区；不写真实工作区 |
| FR-27 进度取消 | application/ProgressManager | 任务进度事件、取消令牌、游标保留 |
| FR-28 会话-任务 | TaskService.linkSession + task_sessions 表 | 多对多关联；P1 自动建议 |
| FR-29 撤销 | application/UndoService + file_backups | 档案回滚 + 文件恢复；审计 |
| FR-30 跨工作区 | StatsService 读取时聚合 | 不建中心库；按注册工作区汇总 |
| FR-31 启动命令 | infrastructure/LaunchCommandBuilder | 按 agent 生成命令；只复制、不执行 |

设计约束：新增功能不得破坏「观察者、零协议、单写者、原子写」四条不变量；P1 功能默认可关闭。界面新增 SearchPanel、OnboardingOverlay、ProgressBar，均复用既有视图框架；图 3-5 为简化视图。

安全与可访问性：NFR-09 由不可信内容分隔、控制字符剥离与禁止自动执行实现；NFR-10 由键盘焦点管理、快捷键、对比度检查与不依赖鼠标的关键操作实现。

## 3.3 设计类图

设计类图以领域模型（图 3-2）为核心，应用服务（图 3-3）通过端口访问基础设施（图 3-4），界面（图 3-5）只经 IPC 调用应用服务。关键关联：

- `Workspace` 聚合 `Session`、`Task`、`DossierItem`；
- `Session` 聚合 `Event`，`Event` 产生 `Evidence`；
- `Candidate` 与 `Evidence` 多对多，接受后生成 `DossierItem`；
- `DossierItem` 拥有多个 `DossierVersion`；
- `Task` 拥有多个 `Handoff`，`Handoff` 指向目标 `AgentProfile`；
- `AgentProfile` 拥有 `Asset` 列表，用于台账与 drift。

## 3.4 其他图

### 3.4.1 交接状态图

[[FIG:../build/diagrams/state-handoff.png|图 3-15 交接状态图|12]]

状态机与需求 FR-17 一致；`Acknowledged` 与 `Outcome` 为 P1，用于记录接手方确认与最终结果。任何状态变更都写入 `audit_log`。

### 3.4.2 候选提取活动图

见 2.2.3 节图 2-4。提取活动与审核活动分离，确保「机器生成候选、人确认档案」的职责边界。

# 4 实现视图

## 4.1 开发组件图

[[FIG:../build/diagrams/component-dev.png|图 4-1 开发组件图|15]]

开发环境由三个包组成：主进程组件、渲染进程组件、本地资源。主进程持有全部用例服务与存储；渲染进程只持有视图、Store 与 IPC Client；本地资源包括 SQLite、agent 日志与工作区文件。

## 4.2 编译后组件图

[[FIG:../build/diagrams/component-compiled.png|图 4-2 编译后组件图|10]]

编译产物为 Electron 应用：`app.asar` 包含 Vue 渲染包、主进程 JS 与 better-sqlite3 原生模块；运行时访问应用数据 SQLite 与工作区文件。

## 4.3 构建与发布流水线

- 包管理：pnpm；构建：electron-builder；
- 测试：vitest（领域/规则/组件）+ playwright（导入→审核→交接端到端）；
- 发布：GitHub Actions 在打标签时构建 Windows/Linux 安装包；构建脚本从 `campus_expense_electron` 目录运行（复用任务01 经验）；
- 安装包命名遵循 electron-builder 产物规则，避免空格与版本号被改写。

## 4.4 目录结构

```
code/
├── src/main/            # Electron 主进程
│   ├── adapters/        # Qoder / Antigravity / Claude 夹具
│   ├── application/     # 用例服务
│   ├── domain/          # 实体与规则
│   ├── infrastructure/  # SQLite、写入器、脱敏、git
│   └── ipc/             # IPC 路由
├── src/renderer/        # Vue3 视图与 Store
├── src/shared/          # 类型与常量
├── tests/               # 单元、夹具、端到端
└── fixtures/            # 会话夹具与黄金文件
```

# 5 进程视图

## 5.1 进程与线程结构

[[FIG:../build/diagrams/process.png|图 5-1 进程视图|9]]

- **渲染进程**：Vue 界面，负责交互与展示，不访问文件系统；
- **主进程 UI 事件循环**：处理 IPC、编排用例；
- **Watcher**：监听日志目录，去抖后触发导入；
- **解析 Worker 池**：并发解析大日志，结果回到主进程；
- **DB 单写者线程**：串行执行所有事务，避免 SQLite 写冲突。

## 5.2 并发、一致性与取消

- 所有写事务经由单写者；事件写入与索引更新在同一事务中完成；
- 文件写入使用「临时文件 + rename + fsync」；写入前计算目标哈希；
- 长任务（扫描、提取、统计）支持取消；取消不破坏已提交数据；
- `ProgressManager` 维护进度与取消令牌，进度事件通过 IPC 推送；取消时等待当前事务提交并保留游标；
- 写入前把目标文件备份到 `backup/`，用于 FR-29 的撤销与恢复；
- Watcher 去抖 500ms，忽略自身写入产生的文件事件；
- 交接认领使用事务条件更新（`WHERE state='Written'`），保证 claim-once。

## 5.3 导入与交接时序与预算

- 导入：100MB 日志首次解析 ≤ 15 秒，增量 ≤ 2 秒（NFR-01）；
- 交接：简报生成 ≤ 1 秒；写入 ≤ 500ms；预览 diff ≤ 1 秒；
- 统计：常用聚合 ≤ 200ms；超时转后台任务并显示进度。

# 6 部署视图

## 6.1 部署图

[[FIG:../build/diagrams/deployment.png|图 6-1 部署图|16]]

## 6.2 运行环境与目录

[[TABLE:表 6-1 运行目录]]
| 内容 | 位置 | 说明 |
|---|---|---|
| 应用 | Electron 安装目录 | Windows/Linux 安装包 |
| 应用数据 | `~/.relay/`（Linux）或 `%APPDATA%/relay/`（Windows） | SQLite、设置、审计日志 |
| Qoder 日志 | `~/.qoder-cn/projects/` | 只读 |
| Antigravity 摘要 | `~/.gemini/antigravity/` | 只读 |
| 工作区文件 | 用户项目目录 | AGENTS.md / CLAUDE.md / HANDOFF.md 受管块 |
| 文件备份 | `~/.relay/backup/` | 写入前备份目标文件，用于撤销 |

## 6.3 安装、升级与数据迁移

- 安装包不写入系统目录，数据默认在用户目录；
- 数据库使用 `PRAGMA user_version` 做迁移；迁移前自动备份；
- 升级不修改工作区文件，除非用户触发写入；
- 卸载默认保留应用数据，提供「连同数据删除」选项；
- 无遥测、无网络请求。

# 7 设计决策与权衡

[[TABLE:表 7-1 关键设计决策]]
| 编号 | 决策 | 备选方案 | 选择理由 |
|---|---|---|---|
| D1 | 观察者而非宿主 | 像 Atlas 一样通过 ACP 托管 agent；像 ai-memory 一样包装启动 | 不要求 agent 兼容协议；不承担 agent 生命周期；演示可控 |
| D2 | 零协议注入 | MCP 工具注入；hook 注入 | 文件是 agent 原生能力；MCP/hook 作为 P1/P2 增强 |
| D3 | 事件溯源 + 派生摘要 | 只存摘要；只存原始日志 | 原始事件可回放；摘要给 agent 读；两者职责分离 |
| D4 | 规则 + 人工审核 | LLM 自动摘要 | 可解释、零模型调用；误报可由人拦截 |
| D5 | 单栈 Electron + SQLite | Tauri + Rust；Electron + FastAPI | 避免系统 WebView；避免双运行时打包成本 |
| D6 | 任务 + Agent 台账 | 只做会话级交接 | 任务级派工符合用户心智；台账让注入方式可选 |
| D7 | 采集分层 | 只做 hooks；只做日志 | 日志零安装；hooks 作为 P1 实时增强 |
| D8 | 脱敏在入库前 | 导出时脱敏 | 隐私风险前移；日志不出机器 |
| D9 | 受管块 + 原子写 | 整文件覆盖；追加写 | 不破坏用户内容；幂等；可回滚 |
| D10 | 2 真实来源 + 1 夹具 | 全量支持所有 agent | 7 周内可交付；适配器可扩展 |
| D11 | 易用性优先 | 只做核心链路；不做引导/搜索/撤销 | 首次使用 5 分钟、进度可见、可撤销，降低学习成本 |

其中 D1、D2 是本项目与现有方案的核心差异：ai-memory/claude-mem 依赖 hooks 或插件，Atlas 依赖 ACP 托管，projectmem/Continuity 依赖 MCP；Relay 在**协议之外**工作，默认零安装。

# 8 数据设计

## 8.1 数据库表

[[TABLE:表 8-1 主要数据表]]
| 表 | 关键字段 | 说明 |
|---|---|---|
| workspaces | id, root_path, git_remote, name, last_scan_at | 工作区 |
| agents | id, kind, installed, log_roots, capabilities, last_seen_at | Agent 台账 |
| sessions | id, workspace_id, agent_id, started_at, ended_at, source_ref | 会话索引 |
| events | id, session_id, type, occurred_at, provenance, payload_ref, fingerprint | 事件日志 |
| evidence | id, event_id, file_ref, line_no, excerpt | 证据 |
| candidates | id, workspace_id, category, statement, confidence, status, scope, evidence_ids | 候选 |
| dossier_items | id, workspace_id, category, statement, scope, status | 档案条目 |
| dossier_versions | id, item_id, version_no, content, diff_summary, created_at | 档案版本 |
| tasks | id, workspace_id, title, goal, status, owner_agent_id, next_step, acceptance | 任务 |
| handoffs | id, task_id, target_agent_id, state, brief_ref, written_at, claimed_at, outcome | 交接 |
| assets | id, agent_id, kind, path, version, hash, last_modified | 资产索引 |
| audit_log | id, actor, action, target, detail, created_at | 审计 |
| task_sessions | task_id, session_id, linked_at | 任务与会话多对多 |
| file_backups | id, workspace_id, path, backup_path, hash, created_at | 写入前备份 |

## 8.2 索引与查询

- `events(session_id, occurred_at)`：时间线；
- `events(type, occurred_at)`：统计与提取；
- `sessions(workspace_id, agent_id)`：工作区视图；
- `candidates(status, confidence)`：收件箱排序；
- `dossier_items(workspace_id, status)`：档案列表；
- `handoffs(state, task_id)`：认领与历史；
- `assets(agent_id, kind, hash)`：drift 检测。
- `task_sessions(task_id, session_id)`：任务上下文；
- `file_backups(path, created_at)`：撤销与恢复；
- FTS5 虚表 `search_events`、`search_candidates`：全局搜索（FR-25）。

## 8.3 工作区文件与受管块

受管块示例：

```markdown
<!-- relay:begin habits hash=ab12cd -->
## 项目习惯
- 优先使用 pnpm；不生成 package-lock.json
- 产物名保留完整版本号与空格
<!-- relay:end habits -->
```

规则：

- 每个受管块有类型与内容哈希；写入前比较哈希，不一致即冲突；
- 标记外内容原样保留；块内只由 Relay 维护；
- `AGENTS.md` 中放一个指针：`开工前先读 HANDOFF.md`；
- 写入顺序：先写 HANDOFF.md，再写 AGENTS.md/CLAUDE.md，最后记录交接；
- P1 可选导出 `.relay/` Markdown，作为人类可读副本，SQLite 为派生索引。

## 8.4 迁移与保留

- 数据库版本由 `user_version` 管理；迁移前备份到 `backup/`；
- 事件默认保留 180 天；档案与交接长期保留；
- 删除项目时级联删除事件、候选、档案版本、任务与交接；
- 删除前二次确认，删除后清理孤立证据。

# 9 接口设计

## 9.1 适配器接口

```typescript
interface LogAdapter {
  id: string;
  capabilities: {
    tools: boolean;
    edits: boolean;
    corrections: boolean;
    usage: boolean;
  };
  discover(root: string): Promise<LogSource[]>;
  fingerprint(source: LogSource): Promise<SchemaFingerprint>;
  parse(source: LogSource, cursor: Cursor): Promise<ParseResult>;
}

type ParseResult = {
  events: RawEvent[];
  nextCursor: Cursor;
  errors: ParseError[];
};
```

适配器必须：未知事件保留为 `UnknownEvent`；损坏行记录后继续；同一事件按稳定指纹去重；不得联网。

## 9.2 IPC 接口

[[TABLE:表 9-1 IPC 通道]]
| 通道 | 方向 | 说明 |
|---|---|---|
| workspace.list/register/rescan/remove | 渲染 → 主 | 工作区 |
| ingest.refresh/status | 渲染 → 主 | 导入与进度 |
| extract.run/list | 渲染 → 主 | 候选生成 |
| review.accept/edit/merge/ignore | 渲染 → 主 | 审核 |
| dossier.list/diff/rollback/export | 渲染 → 主 | 档案 |
| handoff.compose/preview/write/claim | 渲染 → 主 | 交接 |
| task.list/create/link/dispatch | 渲染 → 主 | 任务 |
| catalog.scan/list/capabilities | 渲染 → 主 | 台账 |
| stats.query | 渲染 → 主 | 统计 |
| search.query | 渲染 → 主 | 全局搜索 |
| onboarding.start/demoReset | 渲染 → 主 | 首次引导与演示数据 |
| task.linkSession/unlink | 渲染 → 主 | 会话-任务关联 |
| handoff.launchCommand | 渲染 → 主 | 生成启动命令 |
| stats.crossWorkspace | 渲染 → 主 | 跨工作区总览 |

IPC 使用结构化错误：`{ code, message, detail }`，不返回堆栈给渲染进程。

## 9.3 写入接口

```typescript
interface FileWriter {
  plan(targets: WriteTarget[]): Promise<WritePlan>;
  apply(plan: WritePlan): Promise<WriteResult>;
}

type WriteTarget = {
  path: string;
  block: "habits" | "environment" | "handoff";
  content: string;
};
```

`plan` 只读并计算 diff 与冲突；`apply` 执行原子写。任何 `apply` 失败必须保留原文件。

## 9.4 错误码

[[TABLE:表 9-2 错误码]]
| 错误码 | 含义 | 处理建议 |
|---|---|---|
| RELAY-E001 | 无法识别日志格式 | 检查适配器版本/标记未知来源 |
| RELAY-E002 | 解析失败 | 跳过坏行，记录位置 |
| RELAY-E003 | 脱敏失败 | 阻止入库并提示规则 |
| RELAY-E004 | 受管块冲突 | 展示 diff，等待用户选择 |
| RELAY-E005 | 写入失败 | 保留原文件，允许重试 |
| RELAY-E006 | 交接已被认领 | 阻止重复认领 |
| RELAY-E007 | 数据库忙 | 排队或重试 |
| RELAY-E008 | 目标 agent 不支持该注入方式 | 回退到复制简报 |
| RELAY-E009 | 简报超出预算 | 提示裁剪 |
| RELAY-E010 | 权限不足 | 提示选择可写目录 |

# 附录 A 需求-设计追踪矩阵

[[TABLE:表 A-1 需求-设计追踪]]
| 需求 | 设计章节 | 主要类/接口 |
|---|---|---|
| FR-01 | 3.1.3 / 3.2.1 | Workspace, WorkspaceService |
| FR-02 | 3.1.5 / 9.1 | LogAdapterRegistry, LogAdapter |
| FR-03～FR-05 | 3.2.1 | QoderJsonlAdapter, AntigravitySummaryAdapter, ClaudeFixtureAdapter |
| FR-06 | 3.1.3 / 8.1 | Event, SqliteStore |
| FR-07 | 3.2.1 / 8.3 | RegexRedactor |
| FR-08 | 3.2.1 | SessionView, EventStore |
| FR-09～FR-12 | 3.2.2 | ExtractionService, RuleEngine |
| FR-13～FR-14 | 3.2.3 / 3.4.1 | ReviewService, DossierService |
| FR-15～FR-17 | 3.2.4～3.2.7 | HandoffService, ExportService, HandoffRepository |
| FR-18 | 3.2.8 | StatsService |
| FR-19 | 5.1 | FileWatcher |
| FR-20 | 8.4 | SqliteStore, SettingsStore |
| FR-21～FR-22 | 3.2.9 | CatalogService, AgentRepository, AssetRepository |
| FR-23 | 3.2.6 | TaskService, TaskBoardView |
| FR-24 | 3.2.10 | HookEventReceiver |
| FR-25 | 3.2.10 / 8.2 | SearchService, FTS5 |
| FR-26 | 3.2.10 | OnboardingView, DemoDataService |
| FR-27 | 3.2.10 / 5.2 | ProgressManager |
| FR-28 | 3.2.10 / 8.1 | TaskService, task_sessions |
| FR-29 | 3.2.10 / 5.2 | UndoService, file_backups |
| FR-30 | 3.2.10 | StatsService |
| FR-31 | 3.2.10 | LaunchCommandBuilder |

# 附录 B 类清单

[[TABLE:表 B-1 主要类]]
| 类 | 层 | 职责 |
|---|---|---|
| Workspace | domain | 工作区身份与 git 信息 |
| Session | domain | 一次 agent 会话 |
| Event | domain | 不可变事件 |
| Evidence | domain | 原文定位 |
| Candidate | domain | 待审候选 |
| DossierItem | domain | 档案条目 |
| DossierVersion | domain | 档案版本 |
| Task | domain | 任务与验收 |
| Handoff | domain | 交接与状态 |
| AgentProfile | domain | Agent 台账 |
| Asset | domain | 技能/插件等资产索引 |
| WorkspaceService | application | 工作区注册与重扫 |
| IngestService | application | 导入与增量同步 |
| ExtractionService | application | 规则提取 |
| ReviewService | application | 审核与变更 |
| DossierService | application | 版本与回滚 |
| HandoffService | application | 简报与交接编排 |
| TaskService | application | 任务与派工 |
| CatalogService | application | 台账与能力 |
| StatsService | application | 统计聚合 |
| ExportService | application | 写入、复制、导出 |
| SearchService | application | 全局搜索 |
| ProgressManager | application | 进度与取消 |
| UndoService | application | 撤销与恢复 |
| HookEventReceiver | infrastructure | P1 hook 事件接收 |
| LaunchCommandBuilder | infrastructure | 启动命令生成 |
| OnboardingView | ui | 首次引导 |
| QoderJsonlAdapter | infrastructure | Qoder 日志解析 |
| AntigravitySummaryAdapter | infrastructure | 摘要解析 |
| ClaudeFixtureAdapter | infrastructure | 夹具解析 |
| SqliteStore | infrastructure | 事件与档案存储 |
| ManagedBlockWriter | infrastructure | 受管块 diff/写入 |
| AtomicFileWriter | infrastructure | 原子写 |
| RegexRedactor | infrastructure | 脱敏 |
| FileWatcher | infrastructure | 日志监听 |
| GitIdentityProvider | infrastructure | git 身份 |

# 附录 C 设计不变量

[[TABLE:表 C-1 设计不变量]]
| 编号 | 不变量 | 验证方式 |
|---|---|---|
| C-01 | 事件只追加，不更新 | 代码审查 + 测试 |
| C-02 | 脱敏先于入库 | 集成测试 |
| C-03 | 单写者数据库 | 并发测试 |
| C-04 | 索引与数据同事务 | 事务测试 |
| C-05 | 受管块外内容不变 | 黄金文件测试 |
| C-06 | 写入原子且幂等 | 故障注入 + 重复写测试 |
| C-07 | claim 只发生一次 | 并发认领测试 |
| C-08 | 简报不超预算 | 预算测试 |
| C-09 | 注入内容视为不可信 | 安全测试 |
| C-10 | 无网络请求 | 网络隔离测试 |
| C-11 | 撤销可恢复 | 备份/恢复测试 |
| C-12 | 进度可取消且不产生半成品 | 取消测试 |

# 附录 D 竞品实现对照

[[TABLE:表 D-1 竞品实现对照与借鉴]]
| 项目 | 采集 | 存储 | 注入 | 交接 | 借鉴点 |
|---|---|---|---|---|---|
| ai-memory | hooks + run 包装 | Markdown wiki + SQLite/FTS5 | SessionStart + MCP | claim-once，offer/claim | 事件与摘要分离、单写者、原子写 |
| claude-mem | 每家一个 hook 适配器（含 Qoder 插件） | SQLite + Chroma | 紧凑索引 + MCP | 会话摘要 | 索引/详情两级注入 |
| projectmem | MCP + git hooks | events.jsonl + 摘要 | 小文件 + MCP | 失败警告 | 事件日志、token 预算、受管块 |
| powercontext | 显式/采集 | 版本化 Artifact | 桌面/服务查询 | Contract→Handoff→Ack→Outcome | 交接四步与生命周期 |
| Atlas | ACP 托管 | sessions.db + memory server | 文件 + 记忆服务 | checkpoint 绑定 commit | 提交与会话关联 |
| CC Switch | 日志解析 | 原生配置 + 自身数据 | 改配置/文件 | 会话续跑 | 会话阅读器与统计 UI |
| remembra | git + transcript | 记忆层 | SessionStart/MCP | 1,500 token brief + trail | 简报预算、git remote 身份 |
| axme-code | MCP + hooks | .axme-code/ | MCP context | close 清单原子 finalize | 关闭清单与审计兜底 |
| Basic Memory | MCP | Markdown + wikilink | MCP | 知识库 | 纯文本可携带 |

Relay 的选择：采用 ai-memory 的事件/摘要分离与可靠性不变量、projectmem 的 token 预算与受管块、powercontext 的交接状态、CC Switch 的桌面信息架构；不采用其 hooks/MCP 依赖，保持「零安装日志解析 + 零协议文件注入」的观察者路线。
