const { app, BrowserWindow, Menu, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dbPath =
  process.env.RELAY_DB ||
  (portableDir ? path.join(portableDir, 'RelayData', 'relay.db') : path.join(app.getPath('userData'), 'relay.db'));
let embedded = null;
let mainWindow = null;
let closing = false;
let shotReady = false;

function checkServer() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/api/meta`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function ensureServer() {
  if (await checkServer()) return;
  const serverPath = app.isPackaged ? path.join(process.resourcesPath, 'server.mjs') : path.join(__dirname, 'server.mjs');
  const { createRelayServer } = await import(pathToFileURL(serverPath).href);
  embedded = createRelayServer({
    dbPath,
    uiRoot: path.join(root, 'src', 'ui'),
    fixturesRoot: app.isPackaged ? path.join(process.resourcesPath, 'fixtures') : path.join(root, 'fixtures'),
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    embedded.server.once('error', onError);
    embedded.server.listen(port, '127.0.0.1', () => {
      embedded.server.off('error', onError);
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f6f4ef',
    title: '接力 Relay',
    icon: path.join(root, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  const url = `http://127.0.0.1:${embedded ? embedded.server.address().port : port}/`;
  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.env.RELAY_SHOT) {
    mainWindow.webContents.on('did-finish-load', async () => {
      if (!shotReady && process.env.RELAY_SHOT_WORKSPACE_ID) {
        await mainWindow.webContents.executeJavaScript(
          `localStorage.setItem('relay.workspaceId', ${JSON.stringify(process.env.RELAY_SHOT_WORKSPACE_ID)}); location.reload();`,
        );
        shotReady = true;
        return;
      }
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('[data-view="${process.env.RELAY_SHOT_VIEW || 'handoff'}"]')?.click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.RELAY_SHOT, image.toPNG());
      console.log(`SHOT_OK ${process.env.RELAY_SHOT}`);
      await shutdown();
      app.quit();
    });
  }
  if (process.env.RELAY_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        console.log(`SMOKE_OK ${app.isPackaged ? 'packaged' : 'dev'} electron=${process.versions.electron} node=${process.versions.node}`);
        await shutdown();
        app.quit();
      }, 900);
    });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdown() {
  if (closing) return;
  closing = true;
  if (embedded) {
    const current = embedded;
    embedded = null;
    await current.close();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.zhyuan.relay');
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await ensureServer();
      createWindow();
    } catch (error) {
      dialog.showErrorBox('接力 Relay 启动失败', String(error));
      await shutdown();
      app.quit();
    }
  });
  app.on('before-quit', (event) => {
    if (!closing && embedded) {
      event.preventDefault();
      shutdown().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (embedded) embedded.close();
  });
}
