const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

if (app.isPackaged) {
  process.env.NODE_ENV = 'production';
}

function getResolvedDataDir() {
  const appData = app.getPath('appData');
  const userData = path.join(appData, 'maulana-shoes-inventory-pos');
  if (!fs.existsSync(userData)) {
    try {
      fs.mkdirSync(userData, { recursive: true });
    } catch (e) {}
  }
  return userData;
}

const userDataPath = getResolvedDataDir();
process.env.USER_DATA_PATH = userDataPath;

const logPath = path.join(userDataPath, 'app.log');
function logMsg(msg) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  logMsg(`CRITICAL uncaughtException: ${err ? err.stack || err : 'unknown'}`);
});

process.on('unhandledRejection', (reason) => {
  logMsg(`CRITICAL unhandledRejection: ${reason}`);
});

logMsg(`Starting Maulana Shoes POS. isPackaged=${app.isPackaged}`);
logMsg(`Using persistence directory: ${userDataPath}`);

const dataFilePath = path.join(userDataPath, 'maulana_pos_data.json');

function getBundledTemplatePath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'maulana_pos_data.json'),
    path.join(__dirname, 'maulana_pos_data.json'),
    path.join(__dirname, '..', 'maulana_pos_data.json'),
    path.join(process.cwd(), 'maulana_pos_data.json')
  ];
  for (const c of candidates) {
    try {
      if (c && c !== dataFilePath && fs.existsSync(c)) return c;
    } catch (e) {}
  }
  return null;
}

const bundledDataPath = getBundledTemplatePath();

// Initial seed happens ONLY when the user-data JSON file does not exist.
// Never re-seed or restore bundled default data over existing user data.
if (!fs.existsSync(dataFilePath)) {
  if (bundledDataPath && fs.existsSync(bundledDataPath)) {
    try {
      fs.copyFileSync(bundledDataPath, dataFilePath);
      logMsg(`Seeded initial store data from bundled template to: ${dataFilePath}`);
    } catch (err) {
      logMsg(`Could not seed bundled store data: ${err.message}`);
    }
  }
}

// Direct disk IPC handlers for zero-lag and guaranteed persistence
ipcMain.handle('storage:loadState', async () => {
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, 'utf8');
      return JSON.parse(raw);
    } else if (bundledDataPath && fs.existsSync(bundledDataPath)) {
      const raw = fs.readFileSync(bundledDataPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    logMsg(`Error loading state from disk via IPC: ${err.message}`);
  }
  return null;
});

ipcMain.handle('storage:saveState', async (event, data) => {
  try {
    if (data && typeof data === 'object') {
      const dir = path.dirname(dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const jsonStr = JSON.stringify(data, null, 2);
      fs.writeFileSync(dataFilePath, jsonStr, 'utf8');
      return { success: true };
    }
  } catch (err) {
    logMsg(`Error saving state to disk via IPC: ${err.message}`);
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Invalid data payload' };
});

const { startServer } = require('./server.cjs');

let mainWindow = null;

async function createWindow() {
  try {
    logMsg('Starting local server on port 3000...');
    await startServer(3000);
    logMsg('Local server started successfully on port 3000.');
  } catch (err) {
    logMsg(`Failed to start local server: ${err ? err.stack || err : 'unknown'}`);
    console.error('Failed to start local server:', err);
  }

  const iconPath = path.join(__dirname, 'build', 'icon.ico');

  logMsg('Creating BrowserWindow...');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Maulana Shoes POS',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Non-blocking update check 5 seconds after startup
    setTimeout(() => {
      try {
        logMsg('[Updater] Initiating startup update check...');
        autoUpdater.checkForUpdates().catch(err => {
          logMsg(`[Updater] checkForUpdates catch: ${err.message}`);
        });
      } catch (err) {
        logMsg(`[Updater] checkForUpdates error: ${err.message}`);
      }
    }, 5000);
  });

  mainWindow.webContents.on('render-process-gone', (e, details) => {
    logMsg(`webContents render-process-gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    logMsg(`webContents did-fail-load: code=${code}, desc=${desc}, url=${url}`);
  });

  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    logMsg(`[Renderer] ${message}`);
  });

  logMsg('Loading http://127.0.0.1:3000 in BrowserWindow...');
  mainWindow.loadURL('http://127.0.0.1:3000');

  mainWindow.on('closed', () => {
    logMsg('BrowserWindow closed.');
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (msg) => logMsg(`[Updater Info] ${msg}`),
    warn: (msg) => logMsg(`[Updater Warn] ${msg}`),
    error: (msg) => logMsg(`[Updater Error] ${msg}`)
  };

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'shuaib-chaudhri',
      repo: 'Maulana-Shoes-Inventory-And-POS'
    });
  } catch (err) {
    logMsg(`[Updater] setFeedURL error: ${err.message}`);
  }

  autoUpdater.on('checking-for-update', () => {
    logMsg('[Updater] Checking for update...');
  });

  autoUpdater.on('update-available', async (info) => {
    logMsg(`[Updater] Update available: v${info.version}`);
    if (!mainWindow) return;

    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (v${info.version}) of Maulana Shoes POS is available!`,
        detail: `You are currently using v${app.getVersion()}.\n\nWould you like to download and install this update now?`,
        buttons: ['Update Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (response === 0) {
        logMsg('[Updater] User selected Update Now.');
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('updater:status', {
            status: 'downloading',
            version: info.version
          });
        }
        autoUpdater.downloadUpdate();
      } else {
        logMsg('[Updater] User deferred update (chose Later).');
      }
    } catch (err) {
      logMsg(`[Updater] showMessageBox error: ${err.message}`);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    logMsg(`[Updater] Up to date (current: v${app.getVersion()}).`);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent || 0);
    logMsg(`[Updater] Download progress: ${percent}%`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:progress', {
        percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    logMsg(`[Updater] Update downloaded: v${info.version}`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:status', {
        status: 'downloaded',
        version: info.version
      });
    }

    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Update Ready to Install',
        message: `Update to v${info.version} has finished downloading.`,
        detail: `Would you like to restart Maulana Shoes POS now to apply the update?\n\n(If you choose Later, the update will be installed automatically the next time you close the application.)`,
        buttons: ['Restart & Install Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });

      if (response === 0) {
        logMsg('[Updater] User chose Restart & Install Now. Quitting and installing...');
        setImmediate(() => {
          autoUpdater.quitAndInstall(false, true);
        });
      } else {
        logMsg('[Updater] User postponed restart. Update will apply on next quit.');
      }
    } catch (err) {
      logMsg(`[Updater] update-downloaded dialog error: ${err.message}`);
    }
  });

  autoUpdater.on('error', (err) => {
    logMsg(`[Updater] Error silently handled: ${err ? err.message : 'Unknown'}`);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:status', {
        status: 'error',
        error: err ? err.message : 'Update check failed'
      });
    }
  });
}

ipcMain.handle('updater:checkNow', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result ? result.updateInfo : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  setupAutoUpdater();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
