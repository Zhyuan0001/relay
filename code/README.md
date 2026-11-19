# Relay Core

接力 Relay 的核心实现：本地事件库、20 harness 适配、经验提取、任务板、交接简报与 Electron 便携壳。

运行时要求 Node 24+；核心零第三方运行时依赖（`node:sqlite`、`node:test`、原生 TypeScript）。Electron 45 内置 Node 24.22，因此便携包不依赖系统 Node。

## 状态

- 25/25 测试通过
- 20 个 harness 目录 / 18 个本地适配器（9 具体 + 9 通用 trace）
- 本机真实验证：Qoder、Roo Code、Antigravity、DeepSeek Harness
- 六视图 UI、亮/暗、响应式、任务板、启发式任务建议、规则投影、watcher

## 命令

```bash
npm install
npm test
npm run serve        # http://127.0.0.1:4173
npm run desktop      # build:server + Electron

npm run dist:win     # Windows portable exe（建议 Windows/CI）
npm run dist:linux   # AppImage + tar.gz
npm run dist:mac     # macOS x64/arm64 zip
```

`npm run desktop` 先生成 `desktop/server.mjs`，Electron 主进程在自身 Node 24 中启动本地 HTTP 服务，并打开窗口。便携包中 `server.mjs` 与 `fixtures/` 位于 `resources/`。

## 便携数据位置

- Windows portable：`PORTABLE_EXECUTABLE_DIR/RelayData/relay.db`
- Linux / macOS：Electron `userData` 下的 `relay.db`
- 任意平台可用 `RELAY_DB=/path/to/relay.db` 覆盖

## 支持矩阵

| 类型 | Harness |
|---|---|
| 真实解析 | Qoder、Claude Code、Codex、Roo Code、Cline、Gemini CLI、DeepSeek Harness、Aider |
| 摘要 | Antigravity（SQLite 会话摘要） |
| 通用 trace | OpenCode、Windsurf、Kimi Code、Kiro、OpenClaw、Hermes、Pi、MiniMax Code、Grok |
| 仅 hooks | Cursor |
| 云端-only | Devin |

自动扫描覆盖 Qoder / Claude Code / Codex / Antigravity / Roo / Cline / Gemini / DeepSeek Harness 的默认目录；其余可手动指定。

## 目录

```
desktop/       Electron 主进程与 esbuild 服务端 bundle
src/domain/   类型、规则、标签
src/infrastructure/  适配器、SQLite、脱敏、受管块写入
src/application/     导入、提取、任务建议、审核、交接、投影
src/ui/       零依赖 Web UI
src/server.ts 本地 HTTP API
tests/        node:test
fixtures/     合成会话夹具
```

## 关键实现

- 事件溯源与 provenance；session/event 身份按 workspace 作用域
- 文件游标 `(workspace, source, size, mtime)` + 指纹去重
- 入库前脱敏：密钥、token、邮箱、家目录、代理凭据、私钥
- 规则提取 + 人工审核 + 档案版本；候选按 category + 归一化表述确定性去重
- 任务建议：未关联会话按标题归一化聚类，剥离寒暄/系统块；确定性、无模型
- 交接简报 1,500 token / 120 行预算；失败尝试包裹不可信分隔符
- 受管块按文件合并、原子写、锁、保留 mode、stale 检测、备份
- claim-once 交接；写入/认领自动更新任务 owner 与状态
- 10 个规则投影目标：AGENTS/CLAUDE/GEMINI/CONVENTIONS/.windsurfrules/.clinerules/.roo/.cursor/.qoder/.kiro

## 已知限制

- 单文件多 sessionId 尚未切分
- Cursor 只读取 hooks 产物；Devin 无本地日志
- macOS 便携包未签名/未公证；正式分发需要 Developer ID
- Windows 包在 GitHub Actions 原生构建；本机 Linux 未执行 Windows 二进制
