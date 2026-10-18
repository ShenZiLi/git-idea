# IDEA 分支菜单实施计划

**Goal:** 对照用户截图，复刻日志左侧本地/远程分支的右键菜单及其实际能力，先提交计划，再持续实现。

**Baseline:** `2a736cd`。已有分支树、分支切换、简单管理弹窗、原生 Git 执行与串行写操作。本次在这些流程上增强，不建立另一套 Git 引擎。

**Execution:** 使用 writing-plans 和 subagent-driven-development，在当前会话执行；各工作项独立文件，整合后先审阅需求对照、再审阅代码质量。每批完成改动创建本地提交，不推送。本轮不新增或运行测试，执行构建、代码审阅和 Windows 浏览器界面预览，不在真实仓库试执行检出、更新、推送、合并、变基或工作树创建。

## 资料与方向约定

核对日期：2026-10-17。

- [IDEA Log branches context menu](https://www.jetbrains.com/help/idea/log-tab.html)
- [IDEA Manage branches](https://www.jetbrains.com/help/idea/manage-branches.html)
- [IDEA Merge and rebase](https://www.jetbrains.com/help/idea/apply-changes-from-one-branch-to-another.html)
- [IDEA Worktrees](https://www.jetbrains.com/help/idea/use-git-worktrees.html)
- Git 原生：[branch](https://git-scm.com/docs/git-branch)、[switch](https://git-scm.com/docs/git-switch)、[merge](https://git-scm.com/docs/git-merge)、[rebase](https://git-scm.com/docs/git-rebase)、[fetch](https://git-scm.com/docs/git-fetch)、[push](https://git-scm.com/docs/git-push)、[worktree](https://git-scm.com/docs/git-worktree)。

下文 `C` 是菜单打开时的当前分支，`S` 是右键选中的分支。菜单文本和确认信息必须显示实际名称。当前分支不等于选中分支；右键打开菜单不修改日志筛选。

## 逐项映射

| 截图项目           | 产品行为 / 原生语义                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 签出               | 检出 S；远程 S 创建跟踪本地分支。同名本地分支只有跟踪同一远程时才能直接复用，其他情况提示改用新分支；不静默丢弃提交 |
| 从 S 新建分支      | 选择名称与是否检出；起点固定为 S，不允许混淆成 HEAD                                                                 |
| 签出并变基到 C     | 记录 C 的提交，检出 S，再将 S 变基到记录的 C                                                                        |
| 签出并更新         | 检出 S，再按上游更新；当前分支支持更新                                                                              |
| 与 C 比较          | 默认查看 C..S 的提交和两端文件差异；支持交换方向、提交分页、按文件查看只读差异                                      |
| 显示与工作树的差异 | S 与当前工作区比较，含未暂存、已暂存和未托管文件；可交换差异方向                                                    |
| 将 C 变基到 S      | 不检出 S，变基当前 C 到 S                                                                                           |
| 将 S 合并到 C      | 不检出 S，将 S 合并到当前 C                                                                                         |
| 来自 S 的新工作树  | 选择目标目录、可选新分支；创建真实 linked worktree，可选择在应用打开                                                |
| 更新               | 当前本地分支可选 merge/rebase/ff-only；其他本地分支只做安全快进且不切换；远程分支只获取相应远程引用                 |
| 推送               | 推送选中的本地分支，明确 remote 和目标分支，可设置上游；不隐式推送当前分支，不提供强制推送                          |
| 跟踪分支           | 子菜单列出远程跟踪分支，勾选当前上游；支持改上游和取消跟踪，不推送                                                  |
| 重命名 F2          | 本地分支重命名，保留上游；同名或工作树占用错误显示原生原因                                                          |
| 删除 Delete        | 本地安全删除 `-d`，禁用当前/其他工作树占用的分支；远程删除须明确服务器目标并确认                                    |

远程菜单额外提供“拉取到 C（变基 / 合并）”；先获取目标远程分支，再集成到当前分支。比较不检出、不写工作区。现有冲突解决、继续与中止入口复用，不隐藏部分成功状态：检出后变基失败时说明当前已切换，保留 Git 冲突状态。

## 任务 1：分支上下文与原生操作

**Files:** `shared/branches.ts`、`electron/branches.ts`、`electron/api.ts`。既有 `electron/git.ts` 的通用执行器继续复用，避免重写已有提交逻辑。

类型：

```ts
export interface BranchWorktree {
  path: string;
  branch: string;
  head: string;
  locked?: string;
  prunable?: string;
}
export interface BranchInfo {
  ref: string;
  name: string;
  hash: string;
  remote: boolean;
  currentRef: string;
  currentName: string;
  currentHash: string;
  upstream: string;
  upstreamRemote: string;
  upstreamMerge: string;
  worktrees: BranchWorktree[];
}
```

- [x] `branchInfo({ref})` 读取完整引用、当前提交、跟踪配置和 `worktree list --porcelain -z`。仅允许真实 `refs/heads/`、`refs/remotes/` 分支，不接受 Git 表达式或远程 HEAD 符号引用。
- [x] 写操作使用 `serialize(repo, ...)`；请求携带 `ref, expectedHash, expectedCurrentRef, expectedCurrentHash`，执行前核对上下文，不把过期确认用于不同分支或提交。
- [x] 新动作名称：`branch.checkoutRef`、`branch.createFrom`、`branch.checkoutAndRebase`、`branch.checkoutAndUpdate`、`branch.update`、`branch.pullMerge`、`branch.pullRebase`、`branch.mergeIntoCurrent`、`branch.rebaseCurrent`、`branch.pushSelected`、`branch.track`、`branch.renameRef`、`branch.deleteRef`、`branch.worktree`。API 将此白名单分派给 `mutateBranch`，其他动作继续原处理器。
- [x] 新分支名用原生 `check-ref-format --branch` 校验；网络操作的 remote 只能选当前已配置 remote，远程分支映射读取 fetch refspec / `for-each-ref` 远程信息，不把 URL 或任意 shell 当 remote。
- [x] 检出远程分支不复用跟踪其他远程的同名本地分支；复用同一上游的本地分支时只安全检出，不重置本地提交。普通检出遵守 Git 的改动保护；不自动 force 或 stash。
- [x] 当前分支更新先 fetch 指定上游，再 merge/rebase/ff-only；非当前本地分支禁止在其他 worktree 中使用，fetch 后只安全快进，不使用强制 reset。无上游时返回可操作错误，UI 提供跟踪设置。
- [x] 推送用明确 refspec `refs/heads/S:refs/heads/destination`；可选 `--set-upstream`，禁止 force；远程删除使用明确远程分支并在产品确认后执行。
- [x] 工作树路径必须绝对、非仓库内部/父目录、非 Git 元数据目录，目标只能不存在或为空目录；不得删除、移动目标目录。已有分支被占用时要求新分支；无 `--force`。创建后返回目标路径文字，前端根据用户选择打开。
- [x] 检出并变基、检出并更新等复合操作失败时保留状态与明确错误，原生冲突交给现有继续/中止流程。
- [x] 完成后审阅并创建后端本地提交，不运行测试。

## 任务 2：分支比较读取与界面

**Files:** `shared/branch-compare.ts`、`electron/branch-compare.ts`、`src/components/BranchCompare.tsx`、`src/branch-compare.css`。API 路由由整合者接入，避免并行编辑冲突。

```ts
export interface BranchCompareRequest {
  ref: string;
  mode: "branches" | "worktree";
  reverse?: boolean;
  limit?: number;
}
export interface BranchCompareResult {
  mode: "branches" | "worktree";
  reverse: boolean;
  base: { label: string; hash: string };
  target: { label: string; hash: string };
  commits: Commit[];
  hasMore: boolean;
  files: ChangedFile[];
}
export interface BranchCompareFileRequest {
  path: string;
  oldPath?: string;
  mode: "branches" | "worktree";
  reverse: boolean;
  base: { label: string; hash: string };
  target: { label: string; hash: string };
}
```

- [x] `branchCompare` 解析当前 HEAD 与选中分支为固定提交；分支模式使用 `git log base..target` 和 `git diff base target`，可反向；每批 300，最大 5,000，正确 hasMore。
- [x] 工作树模式基于选中分支和磁盘，不把工作树误当 HEAD。包括未托管文件，排除 Git 忽略文件，重命名按真实源路径读取。
- [x] `branchCompareFile` 返回已有 `DiffData`，只读；使用解析后的提交哈希固定两端，Git 参数数组及字面量路径，不允许路径穿越或仓库外符号链接。二进制与大小限制给出说明，不伪造空文本差异。
- [x] 比较窗口提供方向标题、交换、刷新、提交范围列表/加载更多、文件统计、文件搜索和只读逐行差异；分支比较可查看选中提交详情/文件，避免只能看两端聚合。空态、错误重试、取消请求与切仓库旧响应均处理。
- [x] UI 不触发任何 Git 写动作；黑灰液态玻璃、单一复合输入焦点框，弹窗布局允许滚动，不压缩到无法操作。
- [x] 导出 `BranchCompare({repo,branch,mode,onClose})` 供 App 接入；实际属性/共享契约若调整先向整合者同步。
- [x] 代码审阅后独立本地提交，不新增或运行测试。

## 任务 3：菜单与产品整合

**Files:** `src/components/BranchMenu.tsx`、`src/components/BranchPanel.tsx`、`src/App.tsx`、`src/styles.css`。

- [x] 用 Portal 上下文菜单替代旧管理模态框；右键、行尾省略号、Shift+F10 都能打开。弹层不受分支树裁切，Esc/点击外部关闭，方向键/Tab 可用，关闭后焦点返回触发分支。
- [x] 按截图分组、顺序、分隔线与真实名称呈现本地菜单；当前分支、远程分支、detached HEAD、进行中的 Git 操作和其他工作树占用有相应禁用说明。
- [x] 菜单打开读取 `branchInfo`，加载或失败时显示等待/重试，不用旧对象启动写操作。上下文过期由后端拒绝并提示刷新。
- [x] 跟踪子菜单提供查询、当前上游勾选、取消上游和多远程选项。F2/Delete 只在分支行聚焦时操作，不干扰编辑器文字。
- [x] 新建分支提供“创建后检出”选项；更新提供策略；推送展示源与目标并确认；工作树提供路径、新分支、创建后打开选项。
- [x] 合并和两个变基动作的确认都描述执行前后分支，写动作经过现有自动保存刷新与全局忙碌处理，禁止双击重复执行。
- [x] 从顶部切换器打开的分支管理也使用相同动作流程；比较窗口按仓库绑定，切换仓库后关闭。
- [x] 保留右侧提交固定、黑灰主题和先前日志页能力；不新增工具侧栏。
- [x] 审阅并提交界面改动。

## 任务 4：审阅与交付

**Files:** `docs/idea-branches.md`、`README.md`、本计划。

- [x] 按上表审阅每个按钮真实命令、方向和条件；再审阅引用校验、异步旧响应、焦点、网络目标、工作树占用、失败后部分状态。
- [x] 运行 `npm run build`，确认 TypeScript、Vite、Electron 构建完成；不运行测试，不报告测试通过。
- [x] 使用 Windows 本机浏览器只读预览本地菜单、跟踪子菜单与比较窗口，不试执行 Git 写操作。
- [x] 更新使用说明和实际差异，勾选完成状态，本地提交。
- [x] 生成独立 Windows portable 文件 `release/Git-IDEA-0.1.0-x64-idea-branches.exe`，确认文件存在、工作区干净，不推送。

## 实现边界

交付对照截图的单仓库分支菜单。多仓库同步检出、IDE 工程上下文恢复、Smart Checkout 专有 Shelf 和强制覆盖不是截图中的菜单项目，本轮不自动引入；普通检出失败时保留原生保护信息。非当前分支出现分叉时拒绝强制更新并引导检出后选择合并/变基。当前与选中分支在其他工作树中的状态由 Git 再次校验，不绕过 Git 锁。

## 执行记录（2026-10-18）

- 计划先行：`fe3f569`。后端与比较读取：`fbc02ef`；菜单和比较窗口：`7f7aede`。
- 第二张截图的当前分支菜单已对照：隐藏检出、比较自身、合并/变基自身和删除，保留其余适用项目。
- 需求对照与静态审阅已完成；修正非当前分支已领先上游时误报分叉、跟踪取消幂等、旧跟踪配置、菜单焦点和新工作树打开竞态。代理后续审阅因资源限制不可用，余下审阅由主代理完成。
- BranchInfo 另含可选 remoteTarget（remote/source）以显示自定义 fetch 映射后的真实服务器目标；写请求同时固定期望跟踪配置。
- 远程删除使用显式引用和期望提交租约，仅拒绝已变化服务器分支，不提供强制历史覆盖。
- `npm run build` 完成；Windows 浏览器预览当前/其他分支菜单、跟踪子菜单及真实分支比较，未运行测试，未试执行 Git 写操作。
- 便携包：`release/Git-IDEA-0.1.0-x64-idea-branches.exe`，103734549 字节。
