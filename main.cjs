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
  if (!mainWindow || !mainWindow.isVisible()) {
    try {
      dialog.showErrorBox('Startup Error', `Maulana Shoes POS encountered an error during startup:\n\n${err ? err.message || err : 'Unknown error'}`);
    } catch (e) {}
    app.exit(1);
  }
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

const thermalPrinter = require('./server/thermalPrinter.cjs');

async function getSystemPrinters() {
  if (mainWindow && mainWindow.webContents) {
    return await mainWindow.webContents.getPrintersAsync();
  }
  const tempWin = new BrowserWindow({ show: false, width: 100, height: 100 });
  const printers = await tempWin.webContents.getPrintersAsync();
  try { tempWin.close(); } catch (e) {}
  return printers;
}

// Thermal Printer IPC handlers
ipcMain.handle('printer:getPrinters', async () => {
  try {
    const printers = await getSystemPrinters();
    return { success: true, printers };
  } catch (err) {
    logMsg(`Error retrieving system printers: ${err.message}`);
    return { success: false, error: err.message, printers: [] };
  }
});

ipcMain.handle('printer:printThermal', async (event, { html, printerName }) => {
  try {
    logMsg(`[ThermalPrint] Request received for printer: "${printerName}"`);
    const installed = await getSystemPrinters();
    const validation = thermalPrinter.validatePrinterSelection(printerName, installed, 'thermal barcode printer');
    if (!validation.valid) {
      logMsg(`[ThermalPrint] Validation failed: ${validation.error}`);
      return { success: false, error: validation.error };
    }

    const matchedPrinter = validation.matchedPrinter;
    logMsg(`[ThermalPrint] Target printer confirmed: "${matchedPrinter.name}". Preparing print window...`);

    const printWin = new BrowserWindow({
      show: false,
      width: 300,
      height: 200,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const printOptions = thermalPrinter.getThermalPrintOptions(matchedPrinter.name);

    return await new Promise((resolve) => {
      printWin.webContents.print(printOptions, (success, failureReason) => {
        try { printWin.close(); } catch (e) {}
        if (!success) {
          const errMsg = failureReason || 'Printer rejected print job';
          logMsg(`[ThermalPrint] Job failed on "${matchedPrinter.name}": ${errMsg}`);
          resolve({ success: false, error: errMsg });
        } else {
          logMsg(`[ThermalPrint] Job successfully submitted silently to "${matchedPrinter.name}"`);
          resolve({ success: true, printerName: matchedPrinter.name });
        }
      });
    });
  } catch (err) {
    logMsg(`[ThermalPrint] Exception during print execution: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('printer:printReceipt', async (event, { html, printerName, paperWidth }) => {
  let printWin = null;
  try {
    const target = (printerName || 'RETSOL RTP82').trim();
    logMsg(`[ReceiptPrint] Request received for printer: "${target}"`);
    const installed = await getSystemPrinters();
    const validation = thermalPrinter.validatePrinterSelection(target, installed, 'receipt printer');
    if (!validation.valid) {
      logMsg(`[ReceiptPrint] Validation failed: ${validation.error}`);
      return { success: false, error: validation.error };
    }

    const matchedPrinter = validation.matchedPrinter;
    logMsg(`[ReceiptPrint] Target printer confirmed: "${matchedPrinter.name}". Preparing print window...`);

    const is58 = String(paperWidth || '').trim().toLowerCase() === '58mm';
    const paperKey = is58 ? '58mm' : '80mm';
    // Lay out at the printable width (mm -> CSS px at 96 DPI) so the window matches the printed page
    const winWidth = Math.round(thermalPrinter.getReceiptPrintableWidthMm(paperKey) / 25.4 * 96);

    printWin = new BrowserWindow({
      show: false,
      width: winWidth,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const printOptions = thermalPrinter.getReceiptPrintOptions(matchedPrinter.name, paperKey);
    logMsg(`[ReceiptPrint] Paper setting "${paperWidth}" -> pageSize ${printOptions.pageSize.width}x${printOptions.pageSize.height} microns`);

    return await new Promise((resolve) => {
      printWin.webContents.print(printOptions, (success, failureReason) => {
        try { printWin.close(); } catch (e) {}
        if (!success) {
          const errMsg = failureReason || 'Printer rejected print job';
          logMsg(`[ReceiptPrint] Job failed on "${matchedPrinter.name}": ${errMsg}`);
          resolve({ success: false, error: errMsg });
        } else {
          logMsg(`[ReceiptPrint] Receipt successfully printed silently to "${matchedPrinter.name}"`);
          resolve({ success: true, printerName: matchedPrinter.name });
        }
      });
    });
  } catch (err) {
    logMsg(`[ReceiptPrint] Exception during print execution: ${err.message}`);
    try { if (printWin && !printWin.isDestroyed()) printWin.close(); } catch (e) {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle('printer:exportPdf', async (event, { html, outputPath }) => {
  try {
    const printWin = new BrowserWindow({
      show: false,
      width: 300,
      height: 200,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const pdfBuffer = await printWin.webContents.printToPDF({
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
      printBackground: true
    });

    try { printWin.close(); } catch (e) {}

    let targetPath = outputPath;
    if (!targetPath) {
      targetPath = path.join(userDataPath, `thermal_label_test_${Date.now()}.pdf`);
    }
    fs.writeFileSync(targetPath, pdfBuffer);
    logMsg(`[ThermalPrint] Exported test PDF to: ${targetPath}`);
    return { success: true, filePath: targetPath, size: pdfBuffer.length };
  } catch (err) {
    logMsg(`[ThermalPrint] PDF export error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

const { startServer } = require('./server.cjs');

let mainWindow = null;

async function createWindow() {
  // Port the POS server actually runs on; 3000 unless another program already holds it
  let serverPort = 3000;
  try {
    logMsg('Starting local server on port 3000...');
    const server = await startServer(3000);
    if (server && server.posPort) serverPort = server.posPort;
    logMsg(`Local server started successfully on port ${serverPort}.`);
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

  logMsg(`Loading http://127.0.0.1:${serverPort} in BrowserWindow...`);
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.on('closed', () => {
    logMsg('BrowserWindow closed.');
    mainWindow = null;
  });
}

// Update lifecycle state: 'idle' | 'downloading' | 'downloaded'
let updateState = 'idle';

function startUpdateDownload(version) {
  if (updateState !== 'idle') {
    logMsg(`[Updater] Download request ignored (state: ${updateState}).`);
    return;
  }
  updateState = 'downloading';
  logMsg(`[Updater] Download started: v${app.getVersion()} -> v${version}`);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('updater:status', { status: 'downloading', version });
  }
  // Failures are also emitted via the 'error' event, which resets state and informs the user
  autoUpdater.downloadUpdate().catch(err => {
    logMsg(`[Updater] downloadUpdate rejected: ${err ? err.message : 'Unknown'}`);
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Differential download rebuilds the installer from the locally cached old installer + cached blockmap.
  // When those do not match (manual reinstalls, removed old releases) it fails its sha512 check after
  // reaching 100% and silently restarts as a full download. Always do one verified full download instead.
  autoUpdater.disableDifferentialDownload = true;
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
    logMsg(`[Updater] Update available: v${info.version} (current: v${app.getVersion()})`);
    if (!mainWindow) return;
    if (updateState !== 'idle') {
      logMsg(`[Updater] Update prompt skipped (state: ${updateState}).`);
      return;
    }

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
        startUpdateDownload(info.version);
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
    logMsg(`[Updater] Download progress: ${percent}% (${progressObj.transferred}/${progressObj.total} bytes)`);
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
    updateState = 'downloaded';
    // electron-updater emits this only after the file passed its sha512 verification
    logMsg(`[Updater] Update downloaded and verified: v${info.version} (${info.downloadedFile || 'file path n/a'})`);
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

  autoUpdater.on('error', async (err) => {
    const wasDownloading = updateState === 'downloading';
    const message = err ? err.message : 'Unknown error';
    logMsg(`[Updater] Error (${wasDownloading ? 'during download' : 'during check'}): ${message}` +
      `${err && err.code ? ` [code: ${err.code}]` : ''}${err && err.stack ? `\n${err.stack}` : ''}`);
    if (updateState !== 'downloaded') updateState = 'idle';
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('updater:status', {
        status: 'error',
        phase: wasDownloading ? 'download' : 'check',
        error: message
      });
    }

    // Background check failures (e.g. offline at startup) stay in the log; a failed download the user asked for is shown
    if (!wasDownloading || !mainWindow) return;
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Failed',
        message: 'The update could not be downloaded.',
        detail: `${message}\n\nCheck the internet connection and try again. Your data has not been changed.`,
        buttons: ['Retry', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (response === 0) {
        logMsg('[Updater] User chose Retry after download failure.');
        autoUpdater.checkForUpdates().catch(e => logMsg(`[Updater] Retry check failed: ${e.message}`));
      }
    } catch (dialogErr) {
      logMsg(`[Updater] error dialog failed: ${dialogErr.message}`);
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
