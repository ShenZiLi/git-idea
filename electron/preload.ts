import { contextBridge, ipcRenderer } from 'electron';
import type { ApiRequest } from '../shared/types';
contextBridge.exposeInMainWorld('gitIdea', {
  request: (request: ApiRequest) => ipcRenderer.invoke('git:request', request),
  chooseDirectory: () => ipcRenderer.invoke('git:choose-directory'),
  window: (action: string) => ipcRenderer.send('window:action', action),
});
