<p align="center">
  <img src="public/icon.png" alt="Git IDEA 图标" width="80" height="80" />
</p>

<h1 align="center">Git IDEA</h1>

<p align="center">
  采用 IDEA 风格布局的可视化 Git 桌面客户端。<br />
  在同一工作空间中浏览项目、编辑文件、管理提交、查看历史和操作分支。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="版本 0.1.0" />
  <img src="https://img.shields.io/badge/platform-Windows-0078D4" alt="当前交付平台：Windows" />
  <img src="https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20TypeScript-47848F" alt="Electron、React 与 TypeScript" />
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#使用指南">使用指南</a> ·
  <a href="#开发与构建">开发与构建</a> ·
  <a href="#文档">文档</a> ·
  <a href="https://github.com/ShenZiLi/git-idea/issues">反馈问题</a>
</p>

## 项目介绍

Git IDEA 使用 Electron、React 和 TypeScript 构建，通过本机 Git 操作真实仓库。界面采用项目树、单栏编辑器、固定提交栏、分支树和提交日志组合，适合希望在图形界面中完成日常 Git 工作的开发者。

项目采用液态玻璃外观，支持亮色与中性黑灰暗色模式；字体、编辑器字号和全局缩放可配置，设置修改后立即生效并自动保存。

### 项目状态

| 项目           | 当前状态                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------- |
| 版本           | `0.1.0`，持续开发中                                                                          |
| 交付平台       | Windows，提供便携 EXE 构建方式                                                               |
| macOS / Linux  | 保留构建与 CI 入口，原生适配和验收尚未完成                                                   |
| 开发分支       | [`codex/commit-workbench`](https://github.com/ShenZiLi/git-idea/tree/codex/commit-workbench) |
| GitHub Release | 尚未发布；可从源码运行或本地打包                                                             |

下方快速开始使用当前开发分支。构建记录可在 [GitHub Actions](https://github.com/ShenZiLi/git-idea/actions/workflows/build.yml) 查看。

## 功能特性

### 项目与文件编辑

- 打开、初始化和克隆仓库，保存最近使用的项目。
- 项目树按 Git 状态区分未托管、新增、修改、忽略和冲突文件。
- 多标签单栏编辑器，文本默认可编辑，停顿约 500 毫秒自动保存。
- 显示新增、修改、删除和纯格式变化的行标记。
- 文件内查找与替换，支持大小写、全字、正则表达式和匹配导航。
- 保存前检查外部改动；保存失败时保留草稿并提供处理入口。

### 提交工作台

- 复选框对应真实 Git 暂存，支持部分暂存状态提示。
- 文件级更改列表、活动列表，以及平铺、目录和模块分组。
- 文件多选、右键操作，独立浏览未托管及已忽略文件。
- 按全部已暂存、指定列表或所选文件提交，提交前确认实际范围。
- 修订提交、独立消息草稿、上次提交消息及消息历史。
- 独立搁置 Shelf，支持部分恢复、恢复暂存状态、复制和最近删除。
- 二进制补丁导出、补丁复制、文件回收备份和中断操作恢复。

### 日志、分支与远程

- 提交图谱、文件统计和只读差异预览。
- 文本或哈希、分支、作者、日期及路径组合筛选。
- 引用定位、图谱折叠、可选列和提交右键操作。
- 分支检出、创建、重命名、比较、合并、变基和安全删除。
- 上游跟踪设置、工作树创建、获取、更新及推送。
- 原生 Git stash 的文件预览、应用、弹出和删除。
- Git 命令控制台，查看操作结果和错误信息。

### 外观与布局

- 亮色 / 黑灰暗色模式，半透明玻璃面板。
- 全局缩放档位：70%、80%、90%、100%、110%、125%、150%、175%、200%。
- 自定义界面字体、编辑器字体和编辑器字号。
- 可拖动面板分隔线，提交栏固定显示。

## 快速开始

### 环境要求

| 依赖     | 要求                               |
| -------- | ---------------------------------- |
| 操作系统 | 当前交付平台为 Windows             |
| Node.js  | 24 或更高版本，包含 npm            |
| Git      | 2.37 或更高版本，已加入系统 `PATH` |

应用调用系统 Git，安装包不捆绑 Git。使用远程仓库时，认证由本机 Git 配置及凭据工具处理。

### 从源码启动

```sh
git clone --branch codex/commit-workbench https://github.com/ShenZiLi/git-idea.git
cd git-idea
npm ci
npm run dev
```

该命令会启动 Vite 开发服务和 Electron 窗口。首次使用时可打开已有仓库、新建仓库或从 URL 克隆。

### 生产模式运行

```sh
npm run build
npm start
```

### 构建 Windows 便携版

```sh
npm run package:win
```

默认产物位于 `release/`，名称形如 `Git-IDEA-0.1.0-x64.exe`。保留本机 Git 安装后，可直接运行生成的 EXE。

## 使用指南

### 日常工作流

1. **打开仓库**：从欢迎页或顶部菜单选择本地项目。
2. **查看与编辑**：在项目树打开文件；文本改动会自动保存。
3. **整理更改**：在提交栏创建列表、移动文件，并勾选要暂存的内容。
4. **确认提交**：选择提交范围、填写消息，检查路径和部分暂存提示后提交。
5. **同步远程**：按需要获取、更新或推送；未配置远程时仍可使用本地功能。
6. **查看历史**：使用日志筛选、分支菜单和差异视图查看提交与分支关系。

### 暂存、选择与搁置

| 概念      | 含义                                               |
| --------- | -------------------------------------------------- |
| 勾选文件  | 将文件改动加入真实 Git 暂存区；取消勾选撤销暂存    |
| 选中文件  | 指定差异、回滚、补丁、搁置等操作的目标             |
| 更改列表  | 组织文件及消息草稿，不会自动暂存文件               |
| 范围提交  | 使用所选范围的已暂存版本，保留其他文件的暂存内容   |
| Shelf     | 本应用独立保存的搁置记录，支持按文件恢复和最近删除 |
| Git stash | Git 原生储藏，与 Shelf 分别管理                    |

本应用创建提交时，会过滤约定的纯行尾空白和换行格式差异；缩进和实际内容变化仍可提交，磁盘上的原始格式保留。具体规则见 [编辑器与行改动标记](docs/editor-changes.md)。

### 常用快捷键

以下按当前 Windows 端列出；部分快捷键只在对应视图内生效。

| 操作                 | 快捷键                      |
| -------------------- | --------------------------- |
| 打开仓库             | `Ctrl+O`                    |
| 聚焦提交消息         | `Ctrl+K`                    |
| 预览并确认提交       | `Ctrl+Enter`                |
| 刷新仓库             | `Ctrl+R`                    |
| 显示 / 隐藏项目面板  | `Ctrl+1`                    |
| 显示 / 隐藏 Git 日志 | `Ctrl+9`                    |
| 文件内查找 / 替换    | `Ctrl+F` / `Ctrl+H`         |
| 立即完成自动保存     | `Ctrl+S`                    |
| 提交树中查看差异     | `Ctrl+D`                    |
| 提交树中打开回滚确认 | `Ctrl+Alt+Z`                |
| 目录 / 模块分组      | `Ctrl+Alt+P` / `Ctrl+Alt+M` |
| 上下文菜单           | `Shift+F10`                 |
| 关闭菜单或对话框     | `Esc`                       |

## 开发与构建

### 技术栈

- **桌面运行时**：Electron
- **界面**：React、TypeScript、Vite
- **样式与图标**：CSS、Lucide、自定义侧栏素材
- **仓库操作**：系统 Git CLI
- **分发**：electron-builder

### 项目结构

```text
git-idea/
├── electron/       # 主进程、Git 调用、文件访问及恢复存储
├── src/            # React 界面、编辑器和交互组件
├── shared/         # 共享类型与视图逻辑
├── public/         # 应用图标与静态资源
├── build/          # 打包图标等源资源
├── scripts/        # 启动、构建与检查脚本
├── tests/          # Git 工作流及界面模型测试
├── docs/           # 使用说明、设计与交付记录
└── .github/        # CI 工作流
```

### 常用命令

| 命令                    | 用途                                 |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | 启动 Electron 开发环境               |
| `npm run dev:web`       | 启动本机浏览器开发服务               |
| `npm run typecheck`     | TypeScript 类型检查                  |
| `npm run build`         | 类型检查、界面及 Electron 生产构建   |
| `npm start`             | 运行已有生产构建                     |
| `npm run format`        | 格式化项目源文件                     |
| `npm test`              | Git 工作流及视图模型测试             |
| `npm run test:desktop`  | 生产桌面窗口、沙箱及 IPC 检查        |
| `npm run test:package`  | Windows 打包资源检查                 |
| `npm run test:browser`  | 使用本机 Tabbit Browser 执行界面流程 |
| `npm run package:win`   | 构建 Windows 便携 EXE                |
| `npm run package:mac`   | 在 macOS 上构建 DMG                  |
| `npm run package:linux` | 在 Linux 上构建 AppImage             |

浏览器版本用于本机开发，服务绑定 `127.0.0.1`。不同检查脚本有各自的运行环境要求；列出脚本不代表所有平台和所有功能均已通过验收。历史检查范围见 [验收记录](docs/verification.md) 和 [提交工作台交付记录](docs/superpowers/plans/2026-10-18-commit-workbench.md)。

### 贡献方式

欢迎通过 [Issues](https://github.com/ShenZiLi/git-idea/issues) 反馈问题或讨论功能，通过 [Pull Requests](https://github.com/ShenZiLi/git-idea/pulls) 提交改进。

1. 基于目标开发分支创建自己的功能分支。
2. 保持改动聚焦，更新相关使用说明。
3. 按改动范围完成适用的类型、构建和功能检查。
4. 在 PR 中说明改动内容、检查结果和影响范围。

本仓库要求每批项目文件改动完成后创建本地 Git 提交；未经明确授权不推送远程。完整约定见 [AGENTS.md](AGENTS.md)。

## 文档

| 文档                                         | 内容                                  |
| -------------------------------------------- | ------------------------------------- |
| [提交工作台](docs/commit-workbench.md)       | 更改列表、范围提交、Shelf、补丁及恢复 |
| [编辑器与行改动标记](docs/editor-changes.md) | 自动保存、查找替换和格式过滤          |
| [IDEA 风格分支菜单](docs/idea-branches.md)   | 分支操作、工作树和比较方向            |
| [IDEA 风格日志](docs/idea-log.md)            | 筛选、图谱、导航和显示选项            |
| [液态玻璃界面](docs/liquid-glass.md)         | 外观与主题设计                        |
| [验收记录](docs/verification.md)             | 历史验证范围与平台状态                |

## 已知限制

- 当前以 Windows 为交付平台；macOS、Linux 仍需原生环境适配和验收。
- 文本预览上限为 2 MB；Shelf 原始归档单文件上限 64 MB、单记录上限 256 MB，补丁复制上限 8 MB。
- 通用归档与范围提交暂不支持冲突、链接、子模块、稀疏检出和进行中的合并、变基等状态。合并类操作使用已有的继续 / 中止入口。
- 更改列表按文件归属；文件内代码块归属、UML、外来补丁导入和多仓库统一操作尚未实现。
- 恢复时遇到后续外部编辑、损坏材料或归属未知的锁，会保留材料并停止自动覆盖；详细处理方式见 [提交工作台](docs/commit-workbench.md)。

## 问题反馈与维护

项目由 [ShenZiLi](https://github.com/ShenZiLi) 维护。提交 Issue 时，请说明系统、应用与 Git 版本、复现步骤、预期和实际结果，并附上相关截图或日志。

## 许可证

`package.json` 中声明的许可证为 MIT；仓库当前尚未包含独立的 `LICENSE` 正文文件。
