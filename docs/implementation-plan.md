# Git IDEA Implementation Plan

**Goal:** 实现与参考 IDEA 布局一致、可操作真实仓库的跨平台桌面 Git 客户端。

**Architecture:** Electron 主进程持有 Git 和文件访问能力；React 通过受限请求接口读取快照、发起操作。开发浏览器通过同源本机服务调用同一实现。

**Tech Stack:** Electron, React, TypeScript, Vite, Lucide, Node test runner.

- [x] 基础：包配置、类型、构建脚本与桌面窗口。验证 `npm run build`，提交。
- [x] Git 引擎：仓库发现、状态、日志、差异、文件树、操作白名单。用临时仓库执行 `npm test`，提交。
- [x] IDEA 界面：五区布局、图谱、差异、暂存提交、仓库/分支/远程/储藏对话框。构建并检查真实数据，提交。
- [x] 工作流验证：浏览器操作真实临时仓库并验证结果；桌面 smoke 验证 IPC、文件选择接口和生产渲染，修复后提交。
- [x] 交付：README、快捷键、跨平台 CI 和打包；构建 Windows 便携包、检查 Git 工作区，记录对应证据。
- 后续阶段：macOS 与 Linux 对应系统的原生构建和运行验收。用户已确认本阶段先实现 Windows 端；其他平台不作为本阶段的交付门槛。

实现逐项执行，遇到失败先复现并修复；以实际 Git 输出、UI 状态与构建结果证明功能。
