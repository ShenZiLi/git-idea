import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  net,
  session,
} from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { createApi } from "./api";
import { normalizeUiScale } from "../shared/types";
import type { Bootstrap, Preferences } from "../shared/types";

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
  });
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
  ipcMain.handle("git:choose-directory", async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择 Git 仓库目录",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on("window:action", (event, action) => {
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
