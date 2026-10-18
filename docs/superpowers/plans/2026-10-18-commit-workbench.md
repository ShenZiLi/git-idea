# 提交工作台方案 A 实施计划

**用户确认：** 2026-10-18，用户明确选择“按方案 A 完整实现”。设计依据为 [已确认设计](../specs/2026-10-17-commit-workbench-design.md)，不再等待重复确认。

**Goal:** 保留真实 Git 暂存，完整交付文件级更改列表、范围提交、独立 Shelf、最近删除、分组、忽略项、补丁、文件回收与只读差异窗口。

**Architecture:** 本机 Git + 当前 worktree 的 Git 管理目录存储；原生操作共用仓库队列。新增元数据锁、revision、不可变快照和持久化恢复日志；不把 Shelf 伪装为 stash，不把 UI 选择伪装为 Git 暂存。复用既有自动保存、格式过滤、主进程信任边界与固定提交栏。

**Execution:** 先提交计划，再按任务持续实现。每批完成改动提交本地 Git，不推送。按开发约束不新增或运行测试；使用类型构建、需求对照、静态代码审阅和 Windows 界面预览。开发过程中不对用户真实仓库试执行搁置清理、范围提交或文件删除。并行代理不可用时由主代理继续执行和审阅，不因资源限制停止已授权工作。

## 1. 契约和存储基础

**Files:** `shared/commit-workspace.ts`、`electron/workspace-io.ts`、`electron/commit-workspace.ts`、`electron/git.ts`。

```ts
type CommitScope =
  | { kind: "all-staged" }
  | { kind: "changelist"; id: string }
  | { kind: "files"; paths: string[] };
type Grouping = "flat" | "directory" | "module";
interface ChangeListRecord {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
}
interface CommitWorkspace {
  schemaVersion: 1;
  revision: number;
  activeListId: string;
  lists: ChangeListRecord[];
  assignments: Record<string, string>;
  view: { grouping: Grouping; showIgnored: boolean };
  moduleRoots: { path: string; name: string }[];
  drafts: Record<string, string>;
}
interface OperationResult {
  operationId: string;
  state:
    "completed" | "conflict" | "recovery-required" | "committed-index-pending";
  message: string;
  commitHash?: string;
  affectedPaths: string[];
}
```

- [x] 元数据通过 `rev-parse --absolute-git-dir` 定位到 `git-idea/`，拒绝链接/异常 schema，损坏时保留原件而不覆写空配置。
- [x] worktree 级 `workspace.lock` 使用独占创建，持有进程/时间信息；不自动删除其他实例的锁。元数据 JSON 临时文件写入、同步后替换，保留备份；写操作需要 expectedRevision。
- [x] 内置 `default` 永存；新文件归活动列表，重命名归属跟随路径，不再有变更的路径在完整状态刷新后清理。普通列表删除只移文件归属，活动列表删除后回到 default。
- [x] 增加实际二进制 Git I/O、受限流式补丁落盘、路径/索引/HEAD 指纹、原始快照读写辅助。文件上限 64 MB、记录 256 MB，文本预览 2 MB。路径必须在仓库内，通用归档拒绝冲突、子模块、链接、稀疏检出和进行中的 Git 操作。
- [x] 导出原有索引格式过滤逻辑的可复用入口；只排除已确定的行尾空白/换行，保留缩进和磁盘字节。
- [x] 列表 CRUD/activate/move、draft/view/moduleRoots 都落盘；修改组织不执行 Git add。
- [x] 忽略文件按需 `ls-files --others --ignored --exclude-standard --directory -z` 查询，目录展开再读取，返回分页；不计入更改或暂存数。
- [x] 模块最长路径匹配：手工根优先，其次从变更祖先的真实 package.json/pom.xml/build.gradle/go.mod/Cargo.toml/csproj 识别，不执行脚本；未知单独分组。
- [x] 构建并提交基础模块。

## 2. 范围提交与恢复

**Files:** `electron/commit-index.ts`、`electron/workspace-io.ts`、`electron/api.ts`、`src/App.tsx`。

- [x] 按 scope 从真实已暂存版本确定固定路径；空范围不回退全部，重命名两端一起处理。合并类操作期间只保留原生继续/中止，禁用范围提交。
- [x] 创建私有索引从 HEAD/空树初始化，仅复制原索引选中路径 stage-0 条目和删除；不重新 add 磁盘内容。对私有索引过滤格式变化。
- [x] 持有真实 index.lock 并核对 HEAD/原索引后，以 GIT_INDEX_FILE 指向私有索引执行原生 commit，保留 hooks/签名。读取实际提交路径，不能假设 hook 未额外修改索引。
- [x] 提交成功后在原索引副本同步实际已提交路径到新 HEAD，保留其他条目，发布真实索引；工作区不改写。
- [x] 提交前持久化操作记录及原索引；HEAD 已变化但后处理失败时返回 committed-index-pending 和 commitHash，保留材料、禁止重复提交。恢复只在 HEAD/真实索引仍匹配已知版本时发布候选索引。
- [x] 所有新旧 Git 写入口都检查未决恢复操作，允许明确的 operation.recover。App 接受字符串或 OperationResult，已创建 commitHash 时按“已提交、待恢复”处理，不当作普通失败自动重试或再次推送。
- [x] 完成静态审阅、构建和本地提交。

## 3. Shelf、文件回收与事务

**Files:** `electron/shelves.ts`、`electron/workspace-io.ts`、`shared/commit-workspace.ts`。

- [x] UUID Shelf 保存清单、二进制 full-index 补丁、staged 补丁以及每条路径的 base/index/working 原始快照与 SHA-256，明确 absent。包含重命名两端、模式和原列表。
- [x] 创建支持只复制、归档后移除。无 HEAD 仅复制；先写完整临时归档并核对摘要再发布，之后才清理选中路径，其他路径不动。
- [x] 清理、应用、文件删除都记录 prepared/applying/completed 日志和前后快照。写入前核对指纹；中断保留恢复材料，不宣称跨文件原子事务。
- [x] 恢复指定文件/整条记录，可选择恢复原暂存状态。构建隔离候选索引，使用原生 apply --cached 在候选中预检完整选中批次，不使用 reject/unsafe-paths/自动三方；原始基线匹配时保持完整字节。
- [x] 应用前再次核对全部选中磁盘与索引指纹，冲突整体拒绝；完成后更新 applied 标记和目标列表，复制到工作区保留 active。恢复索引仅影响所选路径，其他暂存内容保留。
- [x] Shelf rename/delete/restore/purge：软删进入最近删除，可预览恢复；永久删除须产品确认，仅能操作已验证 UUID 存档目录；任何递归删除前核对绝对路径在归档根内。
- [x] 文件删除先归档再回收，不自动 git rm；Windows 调用系统回收站，浏览器保留内部可恢复副本。回收和完整回滚都提供恢复材料。
- [x] operation.recover 支持受指纹保护的完成/回滚；后续外部编辑时停止并保留双方材料，不覆盖新内容。恢复面板显示阶段、路径、真实提交 hash。
- [x] 完成代码审阅、构建和本地提交。

## 4. 补丁、原生桥与独立差异窗口

**Files:** `electron/patches.ts`、`electron/main.ts`、`electron/preload.ts`、`shared/types.ts`、`src/components/ReadonlyDiffWindow.tsx`、`src/App.tsx`。

- [x] 补丁按固定路径集和 HEAD→工作区 / HEAD→索引生成，使用 binary/full-index/no-ext-diff/no-textconv，未提交文件可采用空树；导出不改变索引/工作区。大补丁流式写盘。
- [x] savePatch 原生保存对话框取消不报错，copyPatch 限 8 MB；浏览器只下载受限预览大小，超限明确提示桌面文件导出。
- [x] 新桥只接收 repo、已验证范围、内部源 ID，不接受任意命令/URL/文件读取。trashFiles 的源由后端验证备份，主进程只回收验证路径。
- [x] 独立差异窗口以内部 UUID 注册源，继承主题/缩放，关闭时撤销权限；该窗口 request 只允许内部 diffData/bootstrap，禁止 mutate、saveFile、preferences、目录浏览和其他主窗口能力。
- [x] 独立窗口使用只读单栏、Ctrl+F 查找、复制和关闭，不能编辑文件。Shelf/历史/暂存源也只读。
- [x] 构建与提交桥接改动。

## 5. 提交树、菜单与消息

**Files:** `src/components/CommitPanel.tsx`、`CommitTree.tsx`、`CommitContextMenu.tsx`、`ChangeListDialog.tsx`、`CommitMessage.tsx`、`src/commit-workspace.css`。

- [x] 顶部“提交 / 搁置”页签保留消息、修订和选择；Ctrl+K 会切回提交页并聚焦消息。固定面板不新增隐藏入口。
- [x] 文件级更改列表和活动标识，平铺/目录/模块可切换、搜索、展开收起；可见行按 100 批加载。未托管和已忽略单独分组，不混入已托管列表。
- [x] 文件/分组支持单选、Ctrl、Shift 范围多选；复选框仍调用真实暂存，部分暂存 aria-checked=mixed；列表组织不能变成暂存。
- [x] 同一操作模型供工具栏/右键/Shift+F10，含工作区和暂存差异、独立窗口、回滚、完整回滚备份、删除备份、移动列表、列表 CRUD/活动、Shelf、补丁文件/剪贴板。
- [x] 作用域选择全部已暂存/当前列表/所选文件，提交前显示实际路径和部分暂存情况。每个列表独立草稿，修订草稿单独保存；消息历史和上次提交仍可用。
- [x] 快捷键只限树内：Ctrl+D、Ctrl+Alt+Z、Ctrl+Alt+P/M、F2、Delete、Shift+F10。输入框和其他面板不被拦截。
- [x] 错误/加载/重试/空态及过期 revision 显示在当前面板，读请求按 repo+generation 保护，写请求共享 App 自动保存/忙碌流程。
- [x] 构建、审阅、提交。

## 6. Shelf、恢复与 Git 储藏界面

**Files:** `src/components/ShelfPanel.tsx`、`RecoveryPanel.tsx`、`src/components/LogPanel.tsx`、`electron/git.ts`、`electron/api.ts`。

- [x] Shelf 活动/已应用/最近删除、搜索、名称和文件树、部分选择，差异预览、重命名、恢复/复制、恢复原暂存选项、目标列表；删除和永久删除确认。
- [x] 恢复面板列出未决操作、文件回收备份和已创建提交，阻止危险操作并给出完成/回滚入口；不自动删锁或覆盖外部新编辑。
- [x] 原生 Git 储藏继续独立，增加 object hash 稳定标识、执行前确认引用仍对应目标或重新定位，找不到则停止；增加储藏文件差异预览，含未托管部分。
- [x] 通过受限 API 读取 Shelf 差异与归档材料，不向渲染器返回任意磁盘路径权限。
- [x] 构建、审阅、提交。

## 7. 收尾

- [x] 对照已批准设计逐项审阅实现；再审阅并发、索引保留、字节备份、丢失/损坏材料、窗口权限、恢复状态和请求过期。
- [x] `npm run build` 完成类型、Vite 和 Electron 构建；未运行测试时明确说明。
- [x] Windows 浏览器只读预览两页签、树、菜单和空态，避免对真实仓库试执行破坏性操作；保留用户已有应用窗口。
- [x] 更新 README、提交面板/Shelf/恢复说明、计划完成记录，每批本地提交，不推送。
- [x] 生成独立 Windows portable `release/Git-IDEA-0.1.0-x64-commit-workbench.exe` 并确认文件存在。

## 交付记录（2026-10-18）

以上勾选表示实现及所列构建/静态检查已完成，不代表设计文档中的功能验收场景已执行。

- 计划先行：`10468d3`；基础存储：`30a7eb6`；范围提交：`3346644`；Shelf/回收事务：`afb8a70`。
- 原生补丁与独立窗口：`8bd3792`；恢复指纹与元数据：`2cf165f`；工作台界面：`9a3d367`；提交归属及储藏：`731aae8`。
- 操作说明：`228a338`；失效锁入口：`4e4a4e9`；显式锁释放与草稿失败隔离：`dcc5218`。
- 静态审阅覆盖提交归属、分支与索引变化、原始字节、Shelf 元数据回滚、批次大小、确认指纹、跨仓库迟到请求、草稿失败隔离及只读窗口权限。审阅中发现的问题已修复；最后一轮未发现剩余明确 P1/P2 阻塞项。
- 最新 `npm run build` 成功，包含 TypeScript、Vite 和 Electron 构建。未新增或运行测试，未对用户仓库试执行搁置移除、文件回收或范围提交。
- Windows Tabbit 浏览器只读预览：提交树、提交/搁置/恢复页签、视图菜单及空态；保持用户已有窗口和缩放。原生文件回收、恢复故障及多平台场景尚未实际演练。
- Windows portable 打包成功，交付 `release/Git-IDEA-0.1.0-x64-commit-workbench.exe`，文件大小 103,799,621 字节。沿用当前系统 Git，未捆绑 Git。
- 崩溃残留锁支持明确确认后的受保护释放。创建 index.lock 后、写所有权证明前发生崩溃的极窄窗口仍按未知锁保留，需要人工核对；不会自动删除未知锁。
- 所有项目改动按批创建本地 Git 提交，未推送远程。
