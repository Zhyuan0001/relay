# Electron 开发壳

主进程会检查 `127.0.0.1:PORT/api/meta`；没有服务时用系统 `node` 启动 `src/serve.ts`，然后打开窗口。

## 运行

需要 Node 24 与 Electron 33+：

```bash
ELECTRON=~/.local/bin/electron # 或任务01里的 electron
"$ELECTRON" --no-sandbox desktop/main.cjs
```

本仓库没有把 Electron 作为依赖安装；开发时可用任务01 `campus_expense_electron/node_modules/.bin/electron`。

## 烟雾测试

```bash
PORT=4174 RELAY_SMOKE=1 RELAY_DB=/tmp/relay-desktop/relay.db \
  "/path/to/electron" --no-sandbox desktop/main.cjs
```

看到 `SMOKE_OK` 并退出即通过。

## 已知边界

- 开发壳用系统 Node 24（`node:sqlite`）；正式打包需要内置 Node 或换 `better-sqlite3` 适配器。
- 当前不包含安装包/自动更新；electron-builder 在后续里程碑接入。
