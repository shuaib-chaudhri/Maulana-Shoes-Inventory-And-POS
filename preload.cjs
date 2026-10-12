const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  loadState: () => ipcRenderer.invoke('storage:loadState'),
  saveState: (data) => ipcRenderer.invoke('storage:saveState', data),
  checkForUpdates: () => ipcRenderer.invoke('updater:checkNow'),
  onUpdateProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  getPrinters: () => ipcRenderer.invoke('printer:getPrinters'),
  printThermal: (payload) => ipcRenderer.invoke('printer:printThermal', payload),
  printReceipt: (payload) => ipcRenderer.invoke('printer:printReceipt', payload),
  exportThermalPdf: (payload) => ipcRenderer.invoke('printer:exportPdf', payload)
});
