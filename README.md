# Git IDEA

跨平台可视化 Git 桌面工具，按 IntelliJ IDEA 的布局组织本地仓库工作流。使用 Electron、React、TypeScript 和系统 Git。

当前阶段先交付 Windows 端，提供可直接启动的便携 EXE。macOS/Linux 保留构建入口，原生适配与验收放在后续阶段。

## 运行

需要 Node.js 24+ 和 Git 2.28+，确保 `git` 位于系统 PATH。

```sh
npm ci
npm run dev
```

生产模式：

```sh
npm run build
npm start
```

首次打开会显示仓库选择界面，可打开现有仓库、初始化新仓库或从 URL 克隆。开发模式使用当前项目作为默认仓库，桌面程序会记住最近打开的仓库。

## 布局与操作

- 左上：本地项目树，展开目录、打开文件、定位当前文件。
- 中上：多标签文件和差异编辑器，支持并排/统一视图、忽略空白、查找、换行、编辑和保存。
- 右上：已暂存与工作区更改、逐文件/全部暂存、丢弃改动、提交、修订、提交并推送。
- 左下：本地/远程分支及标签。单击筛选日志，双击检出，行尾菜单可管理分支。
- 中下：真实父子关系的提交图谱，支持文本/哈希、分支、作者、日期和文件筛选，分批加载更多历史。
- 右下：提交详情和文件统计。点击文件查看该提交的差异；更多菜单支持拣选、还原、重置、标签。
- 顶部：获取、仅快进拉取、推送、储藏和刷新。底部控制台记录 Git 执行结果；储藏页支持应用、弹出和删除。

分支菜单支持创建、重命名、安全删除、合并和变基；未合并的分支由 Git 拒绝删除。远程仓库通过 Git 面板右上角的 `+` 管理。仓库身份、深浅主题和字号在设置中调整。拖动面板分隔线可调整布局。

冲突文件可从提交区打开，切换「编辑工作区文件」，移除冲突标记并保存，然后点击文件旁的「标记已解决」。全部解决后，在提交区继续或中止操作。编辑器内未保存的文本会在切换标签、仓库或关闭窗口时受到保护。

## 快捷键

| 操作         | Windows / Linux | macOS   |
| ------------ | --------------- | ------- |
| 打开仓库     | Ctrl+O          | ⌘+O     |
| 聚焦提交信息 | Ctrl+K          | ⌘+K     |
| 提交         | Ctrl+Enter      | ⌘+Enter |
| 刷新         | Ctrl+R          | ⌘+R     |
| 项目面板     | Ctrl+1          | ⌘+1     |
| Git 日志     | Ctrl+9          | ⌘+9     |
| 保存编辑内容 | Ctrl+S          | ⌘+S     |

日志聚焦时用 ↑/↓ 选择提交。对话框支持 Escape 关闭及 Tab 焦点循环。

## 打包

```sh
npm run package:win     # Windows 便携 EXE
npm run package:mac     # macOS DMG，在 macOS 上构建
npm run package:linux   # Linux AppImage，在 Linux 上构建
```

产物位于 `release/`。项目提供 Windows、macOS、Linux 的 CI 构建与桌面验证流程。macOS 产物默认未签名；正式分发时需配置开发者签名。Windows 和 Linux 默认使用本机架构。Git 不随应用分发，需要在目标系统安装。

若 Electron 二进制下载受网络影响，可临时设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 和 `ELECTRON_CUSTOM_DIR={{ version }}`，再执行 `node node_modules/electron/install.js`。安装过程会校验发行包摘要。

## 验证

```sh
npm test                # 临时真实 Git 仓库和视图模型测试
npm run build           # TypeScript 检查、界面和 Electron 构建
npm run test:desktop    # 生产窗口、沙箱、IPC 与本地 Git 验证
npm run test:package    # Windows 打包资源与当前生产构建逐文件核对
```

安装了 Tabbit Browser 的本机环境可先启动 `npm run dev:web`，再运行 `npm run test:browser`，在真实临时仓库中验收 20 项界面流程。其他环境可按下列手动流程验收。

测试在系统临时目录内创建仓库和本地裸远程，覆盖空仓库、中文/特殊路径、索引和工作区差异、初次提交、修订、重命名、分支/标签、拣选/还原、合并冲突、储藏、克隆与推拉、二进制和大小限制、路径隔离。不会使用任何真实远程账号。

`node scripts/create-playground.mjs` 可创建用于界面验收的真实临时仓库；路径写入忽略目录 `.test-output/playground.json`。其中包含分支、合并、标签、本地裸远程和待提交文件，便于手动走完整流程。

## 本地开发约定

每次项目文件改动完成后必须提交本地 Git；提交信息说明实际改动。详见 `AGENTS.md`。开发服务只绑定 `127.0.0.1`，浏览器版本仅用于本机开发；正式桌面通过沙箱 preload 接口调用 Git。

桌面权限设计参考 [Electron 安全文档](https://www.electronjs.org/docs/latest/tutorial/security)，状态解析使用 [Git porcelain 格式](https://git-scm.com/docs/git-status)。Git IDEA 是独立项目。
