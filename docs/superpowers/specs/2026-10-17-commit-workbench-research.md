# 提交模块调研：IDEA 与原生 Git

- 调研时间：2026-10-17。
- 项目基线：本地提交 `72ec09d`；Electron + React + TypeScript，Windows 优先。
- 本机 Git：`2.55.0.windows.5`。
- IDEA 文档版本：2026.2；公开源码固定到 `468d73d5c01a0423bd5b3e0765ece3ea1c4460da`，避免以后 master 变化影响结论。
- 方法：阅读 JetBrains 官方帮助，通过 GitHub API 检查公开实现，并阅读 Git 官方命令说明。结论分为已核实事实和本项目设计决策。

## 1. IDEA 的 Git 集成如何分层

### 已核实的公开实现

1. `GitImpl.java` 为状态、差异、储藏等操作构造 `GitLineHandler` 并执行命令。其 `stashSave` 调用 `stash push -m`，`stashPop` 调用 `stash pop`。这说明所检查的实现使用原生 Git 进程；不代表 IDEA 所有版本、所有功能都只有这一条实现路径。
2. `GitShelveChangesSaver.java` 另行调用平台的搁置服务，未把 Shelf 当作 `refs/stash` 的另一种名称。
3. 平台 `ShelveChangesManager.kt` 管理补丁、二进制内容、回滚、恢复和回收状态。它使用 `IdeaTextPatchBuilder` 等平台组件。
4. `ChangeListManagerSerialization.java` 序列化列表 ID、名称、说明、默认列表与变更前后路径。更改列表是 IDE 本地管理的数据。

源码入口：

- [GitImpl.java，stashSave/stashPop](https://github.com/JetBrains/intellij-community/blob/468d73d5c01a0423bd5b3e0765ece3ea1c4460da/plugins/git4idea/backend/src/commands/GitImpl.java#L277)
- [GitShelveChangesSaver.java](https://github.com/JetBrains/intellij-community/blob/468d73d5c01a0423bd5b3e0765ece3ea1c4460da/plugins/git4idea/backend/src/stash/GitShelveChangesSaver.java)
- [ShelveChangesManager.kt](https://github.com/JetBrains/intellij-community/blob/468d73d5c01a0423bd5b3e0765ece3ea1c4460da/platform/vcs-impl/src/com/intellij/openapi/vcs/changes/shelf/ShelveChangesManager.kt)
- [ChangeListManagerSerialization.java](https://github.com/JetBrains/intellij-community/blob/468d73d5c01a0423bd5b3e0765ece3ea1c4460da/platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ChangeListManagerSerialization.java)

### 对本项目的推论

继续采用本机 Git 执行状态、索引、差异和提交操作；在现有 API 旁增加本地更改列表与搁置服务。无需为模仿 IDEA 切换至 JGit、libgit2 或复制 JetBrains 平台实现。本项目将独立实现功能与数据格式，不宣称兼容 `.idea/shelf` 内部格式。

## 2. 容易混淆的语义

| 概念       | 核实结论                                                     | 对本项目的影响                                             |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| 更改列表   | IDEA 用它组织尚未提交的任务变更，支持默认/活动列表及文件移动 | 需要本地元数据；Git 没有对应的原生命名列表                 |
| Git 暂存区 | IDEA 可启用 staging area，官方说明启用时会删除已有更改列表   | 不能把“列表成员”和“已暂存”视为同一件事                     |
| Shelf 搁置 | IDEA 生成并管理补丁，允许选择文件；未托管文件不能直接搁置    | 与现有 Git 储藏保持分开；新增文件先加入 Git                |
| Stash 储藏 | Git 保存工作区/索引的状态，可由命令行读取和恢复              | 继续保留现有 Git 储藏入口                                  |
| 最近删除   | IDEA 的搁置回收与恢复机制                                    | 需要软删除元数据，不能映射成 `git stash drop` 后假装可恢复 |

依据：[更改列表](https://www.jetbrains.com/help/idea/managing-changelists.html)、[Git 设置与暂存区](https://www.jetbrains.com/help/idea/settings-version-control-git.html)、[搁置与储藏](https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html)、[最近删除说明](https://www.jetbrains.com.cn/en-us/help/idea/shelving-and-unshelving-changes.html)。

注意：IDEA 帮助页用“储藏所有变更”概括两者区别，不能据此推导 Git 只能全量储藏。原生 `git stash push` 已支持 pathspec，能够只处理指定路径；本机 2.55 具备该能力。依据：[Git 2.55 stash 手册](https://git-scm.com/docs/git-stash/2.55.0)。

## 3. 截图能力与原生命令映射

| 截图能力           | 原生 Git 基础                                                | 应用必须补充的部分                                 |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| 提交、修订         | `git commit`、`git commit --amend`                           | 消息、勾选状态、校验、失败反馈                     |
| 暂存/取消暂存      | `git add`、`git restore --staged`/`reset`                    | 混合状态、分组、多选及格式过滤                     |
| 回滚               | `git restore --worktree`；指定 HEAD 可同时恢复索引/工作区    | 明确回滚范围、备份、确认，不与撤销历史提交混淆     |
| 显示差异           | `git diff`、`git diff --cached`                              | 只读版本、单栏视图、独立窗口                       |
| 目录/模块分组      | 状态与路径是原始数据                                         | 分组树、模块根、展开收起、持久化                   |
| 显示已忽略文件     | `git ls-files --others --ignored --exclude-standard -z`      | 按需加载、灰色样式、不参与提交                     |
| 新建/编辑/删除列表 | 没有原生命令                                                 | 本地列表数据库与文件归属                           |
| 搁置/取消搁置      | `git diff --binary --full-index`、`git apply` 可作为补丁基础 | 完整索引快照、原始文件备份、事务日志、状态与回收站 |
| 创建/复制补丁      | `git diff --binary --full-index --no-ext-diff --no-textconv` | 文件选择、导出、剪贴板、大小限制                   |
| 删除文件           | 文件系统删除使 Git 显示删除状态；`git rm` 还会暂存删除       | 回收、确认、区分“删除文件”与“删除更改列表”         |
| UML                | Git 仅提供版本及差异，无类型和依赖语义                       | 需要语言解析、符号与依赖图，不属于 Git 提交引擎    |

补丁依据：[IDEA patches](https://www.jetbrains.com/help/idea/using-patches.html)、[git diff](https://git-scm.com/docs/git-diff)。忽略文件依据：[IDEA 忽略文件](https://www.jetbrains.com/help/idea/adding-files-to-version-control.html)、[git ls-files](https://git-scm.com/docs/git-ls-files)。UML 依据：[IDEA 类图](https://www.jetbrains.com/help/idea/class-diagram.html)。

## 4. 恢复与回滚必须遵守的 Git 行为

- `git restore` 不指定 staged 时默认从索引恢复工作区；指定 staged 时默认从 HEAD 恢复索引。两种动作不能共用模糊的“回滚全部”说明。[git restore](https://git-scm.com/docs/git-restore)
- `git apply` 默认在补丁有无法应用的块时拒绝整个补丁；`--reject` 则可能只应用一部分并产生 `.rej`。恢复默认使用前者。[git apply](https://git-scm.com/docs/git-apply)
- `git apply --3way` 可能写入冲突标记，通常还隐含修改索引。首版恢复失败不自动切换到此模式，不把失败显示为成功。[git apply](https://git-scm.com/docs/git-apply)
- `git stash apply` 保留储藏，`pop` 成功后移除；冲突时 `pop` 保留原记录。`--index` 尝试恢复索引状态，也可能失败。[Git 2.55 stash](https://git-scm.com/docs/git-stash/2.55.0)
- Git 补丁中的二进制差异可用 `--binary` 导出；人类阅读用的 textconv 输出不能直接当作可靠补丁。[git diff](https://git-scm.com/docs/git-diff)

## 5. 现有项目差距

已具备：真实暂存复选框、部分暂存提示、批量暂存、回滚未暂存内容、Git 储藏、修订、消息历史、提交并推送确认、编辑器自动保存、索引锁与纯格式过滤。

尚缺：提交/搁置双标签、更改列表持久化、多选与上下文菜单、目录/模块分组、提交栏内忽略文件、独立 Shelf 与最近删除、补丁导出/复制、独立差异窗口。

需要保持：单栏编辑器；固定提交栏；已删除的右侧按钮栏和底部状态栏；设置即时生效；黑灰暗色；Git 忽略状态与行改动颜色；行尾空白/换行格式过滤、缩进可提交；只推送用户明确在产品中选择的操作。

## 6. 建议

采用“Git 索引保持真实 + 更改列表负责组织 + 独立 Shelf 负责可恢复存档”。这是针对本项目的产品取舍，不是声称完整复刻 IDEA 的两种提交模式。详细交互、事务边界和交付范围见同目录设计文档。
