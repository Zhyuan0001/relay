# 接力 Relay · 演进路线

> 课程 v1.0 冻结的是**核心范围**；这里记录后续增强。原则：先做可验证的本地闭环，再增加协议、生态与协作能力。

## P0 · 本地观察者（课程 v1.0）

- 日志解析：Qoder JSONL、Antigravity 摘要、Claude 夹具
- 入库前脱敏、事件溯源、指纹去重、文件级游标
- 纠偏/习惯/环境/任务提取、审核、档案版本
- 交接简报、受管块写入、原子写、claim-once
- 本地 API + 界面、测试与演示数据

## v0.3 · 确定性任务板与便携发布（2026-11-19）

- 任务板四列（待接手/进行中/阻塞/已完成），状态手动推进；交接写入或 claim 自动记录目标 agent 与 in-progress
- 启发式任务建议：未关联任务的会话按标题归一化聚类，剥离寒暄、系统块与截断标签；确认后创建任务并关联会话
- 确定性候选去重：同 category 下标点/大小写/空白差异归一为既有表述，避免重复入收件箱
- Electron 45 内置 Node 24.22 + `node:sqlite`，主进程内启动服务，不依赖系统 Node
- 便携构建：Windows portable exe、Linux AppImage/tar.gz、macOS x64/arm64 zip；GitHub Actions 原生构建并发布 Release
- 测试增至 25/25，加入任务建议、归一化去重、状态流转与自动 owner 测试

## P1 · 工作台易用性

- Electron + Vue3 五视图（概览/收件箱/时间线/档案/交接）
- Agent 台账与兼容矩阵、任务派工、会话-任务关联
- 全局搜索、首次引导、长任务进度/取消、撤销、跨工作区总览
- Qoder/Claude Code hook 适配器（可选安装，失败回退日志）
- 更多真实适配器（Codex、DeepSeek Harness）

## P1.5 · 已完成的多 harness 适配（2026-11-19）

- 已实接：Qoder、Claude Code、Codex、Roo Code、Cline、Gemini CLI、DeepSeek Harness、Aider、Antigravity（摘要）、通用 JSONL
- 目录覆盖 20 个 harness；18 个本地 harness 有适配器（9 个具体 + 9 个通用 trace）；Cursor 仅 hooks；Devin 云端-only
- Electron 开发壳与便携包完成（内置 Node 24 + node:sqlite）
- 会话库完成：工作区分组、会话详情抽屉、会话→任务关联、从会话提炼候选
- v0.2 自动化：按 cwd 自动建工作区（实测 16 个工作区）、watcher 增量导入、自动提炼/认领、会话直接发起交接、规则投影 10 个项目文件（预览/冲突/受管块）
- 本机真实验证：Qoder 11 唯一会话 / 12,157 事件；Roo 4 / 1,452；Antigravity 7；DSH 4 / 5
- 检测探针：目录扫描 + 首源格式/版本探测；Qoder v1.1.79-hotfix.11、Antigravity schema v3、DSH v4；目录存在但无数据不算已安装

## P2 · 注入与生态

- 本地 MCP server：`relay_context`、`relay_handoff`、`relay_search`、`relay_remember`、`relay_status`
- ACP 兼容：优先「事件/会话读取」而非托管；评估 client/host 路由
- 适配器扩展：Cursor、Gemini CLI、更多 harness；schema 指纹与夹具
- 资产索引/导出：skills、MCP、prompts、hooks 的 drift 与投影
- 文档导出：`.relay/` Markdown 真源 + SQLite 派生索引

## P3 · 协作与运行时

- 文件包/git 同步 → 自托管团队服务（鉴权、作用域、审计、冲突解决）
- 跨机器交接；只读聚合总览
- Agent 运行时（最后做）：启动/恢复/沙箱/权限；默认关闭，观察者模式仍是主路径
- 全量 agent 生态与可插拔适配器市场

## 增强研究结论（2026-11-19）

### MCP / ACP

- P2 做 **MCP pull**：stdio 为主，日志走 stderr；工具建议 `relay_context`、`relay_search`、`relay_status`（只读）+ `relay_remember`、`relay_handoff`（写，默认关闭，需 confirm）。
- 文件块是 push（常驻静态），MCP 是 pull（按需、带证据）；已写入部分只返回 `alreadyInjected`，共享 1,500 token 预算，避免重复投喂。
- 安全：写工具默认关闭；workspace 由环境固定；单结果 ≤32KB；限流；每次调用落审计；日志内容视为不可信。
- ACP：**只做会话文件适配 + 事件映射，不托管 agent**；当 client/host 才能拿到实时事件，归 P3。`session/load` 有副作用与版本漂移风险，只做探测。

### 云端 / 团队

- P2 先做 **文件包 + git**：`archive.json` + `manifest.json` + `items/*.md`；只导出脱敏副本；外部条目先入候选隔离区；manifest 带 schema/哈希；冲突 fail-closed。
- P3 再做 **自托管单写者服务**：项目级 ACL、owner-scoped handoff、TLS、append-only 审计、outbox 离线；服务端仍可导出同构文件包。
- 三个坑：不要同步 SQLite/受管块；个人 handoff 与 global profile 作用域泄漏；LWW 静默覆盖与双向同步环。CRDT 只借不可变事件日志思想，不整库 CRDT。

### Agent 运行时 / 适配

- 默认只当**启动器**：复制启动命令 / 打开目录；无头用官方 JSON 流（claude -p、codex exec --json、gemini -p）；PTY 只给真 TUI；ACP host 放 P3，且默认关闭。
- 适配器优先级：Codex → Qoder hooks → DeepSeek Harness → Gemini → Cursor；Cursor 只走 hooks，不解析未公开的 state.vscdb。
- 永远留在观察者模式：采集、候选提炼与人审、档案版本、受管块写入、claim-once、成本统计。托管只保留启动/审批/终止。

## 不变量（所有阶段）

1. 默认本地、默认只读观察；任何联网/托管需显式开启。
2. 证据可回溯；机器生成的结论必须人工确认后才能进入档案。
3. 受管块外内容不改；写入原子、幂等、可撤销。
4. 注入内容视为不可信；不执行日志/会话中的指令。
5. 交接 claim-once；同一交接不重复消费。
6. 范围外能力只能以 P1/P2/P3 形式增量加入，不推翻核心。
