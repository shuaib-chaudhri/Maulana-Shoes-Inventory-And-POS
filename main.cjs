const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

if (app.isPackaged) {
  process.env.NODE_ENV = 'production';
}

function getResolvedDataDir() {
  const devCandidates = [
    'c:\\Users\\shuai\\OneDrive\\Desktop\\Demo\\Demo',
    path.join(__dirname, '..'),
    path.join(process.cwd())
  ];
  for (const dir of devCandidates) {
    try {
      const p = path.join(dir, 'maulana_pos_data.json');
      if (fs.existsSync(p)) {
        fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK);
        return dir;
      }
    } catch (e) {}
  }
  return app.getPath('userData');
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
    'c:\\Users\\shuai\\OneDrive\\Desktop\\Demo\\Demo\\maulana_pos_data.json',
    path.join(process.resourcesPath || '', 'maulana_pos_data.json'),
    path.join(__dirname, 'maulana_pos_data.json'),
    path.join(__dirname, '..', 'maulana_pos_data.json'),
    path.join(process.cwd(), 'maulana_pos_data.json')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) {}
  }
  return null;
}

const bundledDataPath = getBundledTemplatePath();

// Ensure persistent storage file exists with existing store data on fresh install
if (!fs.existsSync(dataFilePath)) {
  if (bundledDataPath && fs.existsSync(bundledDataPath)) {
    try {
      fs.copyFileSync(bundledDataPath, dataFilePath);
      console.log('Seeded store data from bundled template to:', dataFilePath);
    } catch (err) {
      console.warn('Could not seed bundled store data:', err.message);
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
    console.error('Error loading state from disk via IPC:', err);
  }
  return null;
});

ipcMain.handle('storage:saveState', async (event, data) => {
  try {
    if (data && typeof data === 'object') {
      const jsonStr = JSON.stringify(data, null, 2);
      fs.writeFileSync(dataFilePath, jsonStr, 'utf8');
      return { success: true };
    }
  } catch (err) {
    console.error('Error saving state to disk via IPC:', err);
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

app.whenReady().then(createWindow);

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
