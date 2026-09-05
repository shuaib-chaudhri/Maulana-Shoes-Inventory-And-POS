const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  loadState: () => ipcRenderer.invoke('storage:loadState'),
  saveState: (data) => ipcRenderer.invoke('storage:saveState', data)
});
