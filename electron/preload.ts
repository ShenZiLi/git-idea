import { contextBridge, ipcRenderer } from "electron";
import type { ApiRequest } from "../shared/types";
contextBridge.exposeInMainWorld("gitIdea", {
  request: (request: ApiRequest) => ipcRenderer.invoke("git:request", request),
  chooseDirectory: () => ipcRenderer.invoke("git:choose-directory"),
  savePatch: (repo: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke("git:save-patch", { repo, params }),
  copyPatch: (repo: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke("git:copy-patch", { repo, params }),
  saveArchiveFile: (repo: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke("git:save-archive", { repo, params }),
  openDiffWindow: (repo: string, source: Record<string, unknown>) =>
    ipcRenderer.invoke("git:diff-window", { repo, source }),
  copyReadonly: () => ipcRenderer.invoke("git:copy-readonly"),
  window: (action: string) => ipcRenderer.send("window:action", action),
});
