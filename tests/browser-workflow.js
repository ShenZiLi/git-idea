// Run through scripts/check-browser.mjs with the Tabbit Browser skill runtime.
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:5173");
await page
  .getByRole("button", { name: "打开仓库 Ctrl O", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "仓库目录", exact: true })
  .fill(fixture.repo);
await page
  .getByRole("dialog")
  .getByRole("button", { name: "打开", exact: true })
  .click();
await expect(
  page.getByRole("banner").getByRole("button", { name: "dev", exact: true }),
).toBeVisible();
const list = page.getByRole("listbox", { name: "提交日志" });
await expect(list.getByRole("option")).toHaveCount(8);

await page.getByRole("button", { name: "status.ts M", exact: true }).click();
await expect(page.locator(".diff-row")).toHaveCount(9);
await page.getByRole("button", { name: "统一差异", exact: true }).click();
await expect(page.locator(".diff-content.unified")).toBeVisible();
await page.getByRole("button", { name: "并排差异", exact: true }).click();
await page
  .getByRole("checkbox", { name: "暂存 src/git/status.ts", exact: true })
  .click();
await expect(
  page.getByRole("checkbox", {
    name: "取消暂存 src/git/status.ts",
    exact: true,
  }),
).toBeChecked();
await page
  .getByRole("textbox", { name: "提交信息", exact: true })
  .fill("test: verify visual Git commit");
await page.locator(".commit-actions .primary").click();
await expect(
  list
    .getByRole("option")
    .filter({ hasText: "test: verify visual Git commit" }),
).toBeVisible();
await page
  .getByRole("textbox", { name: "搜索提交", exact: true })
  .fill("visual Git commit");
await expect(list.getByRole("option")).toHaveCount(1);
await page.getByRole("button", { name: "清除搜索", exact: true }).click();
await expect(list.getByRole("option")).toHaveCount(9);

await page.getByRole("button", { name: "储藏更改", exact: true }).click();
await page
  .getByRole("textbox", { name: "说明", exact: true })
  .fill("visual stash verification");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "储藏", exact: true })
  .click();
await expect(page.locator(".stash-row")).toHaveCount(1);
await page.getByRole("button", { name: "弹出", exact: true }).click();
await expect(page.locator(".stash-row")).toHaveCount(0);

await page.getByRole("button", { name: "新建分支", exact: true }).click();
await page
  .getByRole("textbox", { name: "分支名称", exact: true })
  .fill("test/ui-workflow");
await page.getByRole("button", { name: "创建并检出", exact: true }).click();
await expect(
  page
    .getByRole("banner")
    .getByRole("button", { name: "test/ui-workflow", exact: true }),
).toBeVisible();
await page
  .getByRole("banner")
  .getByRole("button", { name: "test/ui-workflow", exact: true })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "dev 检出", exact: true })
  .click();
await expect(page.locator(".branch-selector")).toHaveText(/^dev/);

await page.getByRole("button", { name: "切换深浅主题", exact: true }).click();
await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
await page.getByRole("button", { name: "切换深浅主题", exact: true }).click();
await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
await page.getByRole("button", { name: "隐藏 Git 窗口", exact: true }).click();
await expect(page.locator(".git-window")).toHaveCount(0);
await page
  .getByRole("button", { name: "Git 日志（Ctrl 9）", exact: true })
  .click();
await expect(page.locator(".git-window")).toBeVisible();
await page.getByRole("button", { name: "获取远程更新", exact: true }).click();
await expect(
  page.getByRole("button", { name: "获取远程更新", exact: true }),
).toBeEnabled();

await page.getByRole("button", { name: "Git 控制台", exact: true }).click();
await expect(
  page.locator(".console-entry").filter({ hasText: "git commit" }).first(),
).toBeVisible();
await page.getByRole("button", { name: "新建标签", exact: true }).click();
await page
  .getByRole("textbox", { name: "标签名称", exact: true })
  .fill("ui-verified");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "创建标签", exact: true })
  .click();
await expect(
  page.getByRole("button", { name: "删除标签 ui-verified", exact: true }),
).toBeVisible();
await page
  .getByRole("button", { name: "删除标签 ui-verified", exact: true })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "确认", exact: true })
  .click();
await expect(
  page.getByRole("button", { name: "删除标签 ui-verified", exact: true }),
).toHaveCount(0);

await page.getByRole("button", { name: "管理远程仓库", exact: true }).click();
await page.getByRole("button", { name: "添加远程…", exact: true }).click();
await page
  .getByRole("textbox", { name: "远程名称", exact: true })
  .fill("backup");
await page
  .getByRole("textbox", { name: "远程地址", exact: true })
  .fill(fixture.remote);
await page
  .getByRole("dialog")
  .getByRole("button", { name: "添加远程", exact: true })
  .click();
await page.getByRole("button", { name: "管理远程仓库", exact: true }).click();
await page
  .getByRole("button", { name: "移除远程 backup", exact: true })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "确认", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);

await page.getByRole("button", { name: "notes.md U", exact: true }).click();
await page.getByRole("button", { name: "编辑工作区文件", exact: true }).click();
await page
  .getByRole("textbox", { name: "文件内容", exact: true })
  .fill("# Saved from Git IDEA\n");
await page
  .getByRole("button", { name: "刷新仓库（Ctrl R）", exact: true })
  .click();
await expect(
  page.getByRole("textbox", { name: "文件内容", exact: true }),
).toHaveValue("# Saved from Git IDEA\n");
await page
  .locator(".project-panel")
  .getByRole("button", { name: "README.md", exact: true })
  .click();
await expect(page.getByRole("dialog")).toBeVisible();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "取消", exact: true })
  .click();
await expect(
  page.getByRole("textbox", { name: "文件内容", exact: true }),
).toHaveValue("# Saved from Git IDEA\n");
await page.getByRole("button", { name: "保存文件", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "文件内容", exact: true }),
).toHaveCount(0);
assert.deepEqual(errors, []);
return {
  passed: [
    "open repository",
    "real graph",
    "split and unified diff",
    "stage",
    "commit",
    "search",
    "stash save and pop",
    "create and switch branch",
    "dark and light themes",
    "toggle panels",
    "fetch",
    "command log",
    "create and delete tag",
    "add and remove remote",
    "file edit and save",
    "unsaved draft guard",
  ],
  errors,
  fixture: fixture.repo,
};
