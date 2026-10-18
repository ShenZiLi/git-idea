import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  net,
  session,
  clipboard,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { createApi } from "./api";
import { normalizeUiScale } from "../shared/types";
import type { Bootstrap, DiffData, Preferences } from "../shared/types";
import { repository } from "./git";
import { archivedFileBytes } from "./shelves";
import {
  CLIPBOARD_LIMIT,
  discardPatch,
  preparePatch,
  readonlyDiff,
} from "./patches";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "gitidea",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | null = null;
const devURL = process.env.VITE_DEV_SERVER_URL;
const appURL = "gitidea://app";
const windowBackground = (theme?: string) =>
  theme === "light" ? "#e4edf7" : "#090909";
app.setName("Git IDEA");
app.whenReady().then(async () => {
  const root = path.join(__dirname, "../dist");
  protocol.handle("gitidea", (request) => {
    const url = new URL(request.url);
    const file = path.resolve(
      root,
      `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
    );
    if (url.host !== "app" || !file.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const api = createApi({
    preferencesPath:
      process.env.GIT_IDEA_PREFERENCES ||
      path.join(app.getPath("userData"), "preferences.json"),
    defaultRepo: process.env.GIT_IDEA_REPO,
    trashItem: (absolute) => shell.trashItem(absolute),
  });
  const readers = new Map<
    number,
    {
      id: string;
      data: DiffData;
      preferences: Preferences;
      window: BrowserWindow;
    }
  >();
  const trusted = (
    event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  ) => {
    const url = event.senderFrame?.url || "";
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !(url.startsWith(appURL + "/") || (devURL && url.startsWith(devURL)))
    )
      throw new Error("请求来源无效");
  };
  ipcMain.handle("git:request", async (event, request) => {
    const reader = readers.get(event.sender.id);
    if (reader) {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        request?.method !== "readonlyBootstrap" ||
        request.params?.id !== reader.id
      )
        throw new Error("此窗口仅支持读取已打开的差异");
      return { data: reader.data, preferences: reader.preferences };
    }
    trusted(event);
    const result = await api(request);
    if (request.method === "preferences") {
      window?.setBackgroundColor(
        windowBackground((result as Preferences).theme),
      );
      window?.webContents.setZoomFactor(
        normalizeUiScale((result as Preferences).uiScale) / 100,
      );
    }
    return result;
  });
  ipcMain.handle("git:save-patch", async (event, payload) => {
    trusted(event);
    const repo = await repository(payload.repo),
      patch = await preparePatch(repo, payload.params || {});
    try {
      const result = await dialog.showSaveDialog(window!, {
        title: "导出补丁",
        defaultPath: patch.name,
        filters: [{ name: "Git 补丁", extensions: ["patch"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const relative = path.relative(
        path.dirname(patch.file),
        path.resolve(result.filePath),
      );
      if (
        !relative ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      )
        throw new Error("请将补丁保存到应用内部临时目录之外");
      await fs.copyFile(patch.file, result.filePath);
      return result.filePath;
    } finally {
      await discardPatch(repo, patch.file).catch(() => {});
    }
  });
  ipcMain.handle("git:copy-patch", async (event, payload) => {
    trusted(event);
    const repo = await repository(payload.repo),
      patch = await preparePatch(repo, payload.params || {});
    try {
      if (patch.size > CLIPBOARD_LIMIT)
        throw new Error("补丁超过 8 MB，请导出到文件");
      clipboard.writeText(await fs.readFile(patch.file, "utf8"));
      return patch.size;
    } finally {
      await discardPatch(repo, patch.file).catch(() => {});
    }
  });
  ipcMain.handle("git:save-archive", async (event, payload) => {
    trusted(event);
    const file = await archivedFileBytes(
      await repository(payload.repo),
      payload.params || {},
    );
    const result = await dialog.showSaveDialog(window!, {
      title: "另存归档文件",
      defaultPath: file.name,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, file.data);
    return result.filePath;
  });
  ipcMain.handle("git:copy-readonly", (event) => {
    const reader = readers.get(event.sender.id);
    if (!reader || event.senderFrame !== event.sender.mainFrame)
      throw new Error("此复制入口仅供已注册的只读差异窗口使用");
    const data = reader.data;
    if (data.binary || data.truncated)
      throw new Error("二进制或超限差异不能复制为文本");
    const text =
      data.raw ||
      `${data.beforeLabel}\n${data.before}\n\n${data.afterLabel}\n${data.after}`;
    if (Buffer.byteLength(text, "utf8") > CLIPBOARD_LIMIT)
      throw new Error("差异超过 8 MB，请另存归档文件");
    clipboard.writeText(text);
  });
  ipcMain.handle("git:diff-window", async (event, payload) => {
    trusted(event);
    const data = await readonlyDiff(
      await repository(payload.repo),
      payload.source || {},
    );
    const { preferences } = (await api({ method: "bootstrap" })) as Bootstrap;
    const id = randomUUID(),
      reader = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 650,
        minHeight: 400,
        frame: false,
        title: "只读差异",
        backgroundColor: windowBackground(preferences.theme),
        webPreferences: {
          zoomFactor: normalizeUiScale(preferences.uiScale) / 100,
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
    readers.set(reader.webContents.id, {
      id,
      data,
      preferences,
      window: reader,
    });
    const contentsId = reader.webContents.id;
    reader.on("closed", () => readers.delete(contentsId));
    reader.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    reader.webContents.on("will-navigate", (event) => event.preventDefault());
    try {
      await reader.loadURL(
        `${devURL || appURL + "/"}${(devURL || "").includes("?") ? "&" : "?"}diffWindow=${id}`,
      );
    } catch (error) {
      reader.destroy();
      throw error;
    }
  });
  ipcMain.handle("git:choose-directory", async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择 Git 仓库目录",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on("window:action", (event, action) => {
    const reader = readers.get(event.sender.id);
    if (reader) {
      if (event.senderFrame === event.sender.mainFrame && action === "close")
        reader.window.close();
      return;
    }
    trusted(event);
    if (action === "close") window?.close();
    else if (action === "minimize") window?.minimize();
    else if (action === "maximize")
      window?.isMaximized() ? window.unmaximize() : window?.maximize();
  });
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  const createWindow = async () => {
    const { preferences } = (await api({ method: "bootstrap" })) as Bootstrap;
    window = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1000,
      minHeight: 680,
      backgroundColor: windowBackground(preferences.theme),
      frame: false,
      title: "Git IDEA",
      icon: path.join(__dirname, "../dist/icon.png"),
      webPreferences: {
        zoomFactor: normalizeUiScale(preferences.uiScale) / 100,
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== (devURL || `${appURL}/`)) event.preventDefault();
    });
    window.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(window!, {
        type: "question",
        buttons: ["继续编辑", "放弃编辑并关闭"],
        defaultId: 0,
        cancelId: 0,
        title: "未保存的编辑",
        message: "当前文件还有未保存的编辑。",
      });
      if (choice === 1) event.preventDefault();
    });
    window.on("closed", () => {
      window = null;
    });
    if (devURL) await window.loadURL(devURL);
    else await window.loadURL(`${appURL}/`);
    if (process.env.GIT_IDEA_SMOKE) {
      try {
        const result = await window.webContents.executeJavaScript(
          `(async () => { const bootstrap = await window.gitIdea.request({ method: 'bootstrap' }); const snap = await window.gitIdea.request({ method: 'snapshot', repo: bootstrap.defaultRepo }); for (let i=0; i<100 && !document.querySelector('.log-row'); i++) await new Promise(resolve => setTimeout(resolve, 50)); return { title: document.title, platform: bootstrap.platform, branch: snap.branch, commits: snap.commits.length, rendered: !!document.querySelector('.app .log-row'), isolated: typeof require === 'undefined', bridge: typeof window.gitIdea.chooseDirectory === 'function' }; })()`,
        );
        if (process.env.GIT_IDEA_SCREENSHOT) {
          await window.webContents.executeJavaScript(
            `(async () => { for (let i=0;i<100&&!document.querySelector('.detail-file');i++) await new Promise(r=>setTimeout(r,50)); const files=[...document.querySelectorAll('.detail-file')]; const file=files.find(f=>/\.tsx?$/.test(f.title))||files[0]; file?.click(); for(let i=0;i<100&&!document.querySelector('.diff-row');i++) await new Promise(r=>setTimeout(r,50)); })()`,
          );
          const screenshot = await window.webContents.capturePage();
          await fs.writeFile(
            process.env.GIT_IDEA_SCREENSHOT,
            screenshot.toPNG(),
          );
        }
        console.log("SMOKE_RESULT=" + JSON.stringify(result));
        app.exit(
          result.isolated &&
            result.bridge &&
            result.rendered &&
            result.commits > 0
            ? 0
            : 1,
        );
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    }
  };
  Menu.setApplicationMenu(null);
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
