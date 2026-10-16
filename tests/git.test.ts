import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  git,
  repository,
  snapshot,
  mutate,
  diff,
  commitDetail,
  tree,
  readFile,
  saveFile,
  history,
  commandLogs,
} from "../electron/git";
import { createApi } from "../electron/api";

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "git-idea-test-"));
  const repo = path.join(base, "repo");
  await fs.mkdir(repo);
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.name", "Test Developer"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await git(repo, ["config", "core.autocrlf", "false"]);
  return {
    base,
    repo,
    write: (name: string, content: string | Buffer) =>
      fs.writeFile(path.join(repo, name), content),
    clean: () => fs.rm(base, { recursive: true, force: true }),
  };
}
test("unborn repository, Unicode paths, staging, first commit and root diff", async () => {
  const f = await fixture();
  try {
    let s = await snapshot(f.repo);
    assert.equal(s.branch, "main");
    assert.equal(s.commits.length, 0);
    await f.write("你好 world.txt", "first\n");
    s = await snapshot(f.repo);
    assert.equal(s.changes[0].path, "你好 world.txt");
    const working = await diff(f.repo, { path: "你好 world.txt" });
    assert.equal(working.before, "");
    assert.equal(working.after, "first\n");
    await mutate(f.repo, "stage", { paths: ["你好 world.txt"] });
    const staged = await diff(f.repo, { path: "你好 world.txt", staged: true });
    assert.equal(staged.after, "first\n");
    await mutate(f.repo, "unstage", { paths: ["你好 world.txt"] });
    assert.equal((await snapshot(f.repo)).changes[0].index, "?");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "initial commit" });
    s = await snapshot(f.repo);
    assert.equal(s.changes.length, 0);
    assert.equal(s.commits[0].subject, "initial commit");
    const detail = await commitDetail(f.repo, "HEAD");
    assert.equal(detail.files[0].additions, 1);
    const rootDiff = await diff(f.repo, {
      path: "你好 world.txt",
      commit: "HEAD",
    });
    assert.equal(rootDiff.before, "");
    assert.equal(rootDiff.after, "first\n");
  } finally {
    await f.clean();
  }
});
test("index and worktree remain distinct; amend, rename and deleted file diff", async () => {
  const f = await fixture();
  try {
    await f.write("old name.txt", "a\nb\nc\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "first" });
    await f.write("old name.txt", "a\nB\nc\n");
    await mutate(f.repo, "stage", {});
    await f.write("old name.txt", "a\nB\nC\n");
    assert.equal(
      (await diff(f.repo, { path: "old name.txt", staged: true })).after,
      "a\nB\nc\n",
    );
    const d = await diff(f.repo, { path: "old name.txt" });
    assert.equal(d.before, "a\nB\nc\n");
    assert.equal(d.after, "a\nB\nC\n");
    await mutate(f.repo, "discard", { paths: ["old name.txt"] });
    assert.equal((await readFile(f.repo, "old name.txt")).text, "a\nB\nc\n");
    await mutate(f.repo, "commit", { message: "amended", amend: true });
    assert.equal((await history(f.repo)).length, 1);
    await git(f.repo, ["mv", "old name.txt", "新 name.txt"]);
    await mutate(f.repo, "commit", { message: "rename" });
    const detail = await commitDetail(f.repo, "HEAD");
    assert.equal(detail.files[0].status, "R");
    assert.equal(detail.files[0].oldPath, "old name.txt");
    const renamed = await diff(f.repo, {
      path: "新 name.txt",
      oldPath: "old name.txt",
      commit: "HEAD",
    });
    assert.equal(renamed.before, renamed.after);
    await fs.unlink(path.join(f.repo, "新 name.txt"));
    assert.equal((await diff(f.repo, { path: "新 name.txt" })).after, "");
  } finally {
    await f.clean();
  }
});
test("branches, tags, filters, cherry pick, revert and safe branch deletion", async () => {
  const f = await fixture();
  try {
    await f.write("a.txt", "a");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await mutate(f.repo, "branch.create", { name: "feature/test" });
    await f.write("b.txt", "b");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "feature content" });
    const hash = (await snapshot(f.repo)).commits[0].hash;
    await mutate(f.repo, "tag.create", { name: "v1.0", ref: hash });
    assert.equal((await snapshot(f.repo)).tags[0].name, "v1.0");
    await mutate(f.repo, "branch.checkout", { name: "main" });
    await assert.rejects(
      mutate(f.repo, "branch.delete", { name: "feature/test" }),
    );
    await mutate(f.repo, "cherry-pick", { ref: hash });
    assert.equal((await readFile(f.repo, "b.txt")).text, "b");
    await mutate(f.repo, "revert", { ref: "HEAD" });
    await assert.rejects(readFile(f.repo, "b.txt"));
    assert.equal(
      (await history(f.repo, { search: "feature content" })).length > 0,
      true,
    );
    assert.equal(
      (await history(f.repo, { ref: "main", file: "a.txt" })).length,
      1,
    );
    await mutate(f.repo, "branch.rename", {
      name: "feature/test",
      newName: "feature/renamed",
    });
    await mutate(f.repo, "tag.delete", { name: "v1.0" });
    assert.equal((await snapshot(f.repo)).tags.length, 0);
  } finally {
    await f.clean();
  }
});
test("stash includes untracked files, apply/pop and drop work on real Git", async () => {
  const f = await fixture();
  try {
    await f.write("a.txt", "base");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await f.write("a.txt", "modified");
    await f.write("new.txt", "untracked");
    await mutate(f.repo, "stash.save", { message: "work in progress" });
    let s = await snapshot(f.repo);
    assert.equal(s.changes.length, 0);
    assert.equal(s.stashes.length, 1);
    await mutate(f.repo, "stash.apply", { ref: "stash@{0}" });
    assert.equal((await readFile(f.repo, "new.txt")).text, "untracked");
    await mutate(f.repo, "discard", { paths: ["a.txt", "new.txt"] });
    await mutate(f.repo, "stash.pop", { ref: "stash@{0}" });
    assert.equal((await snapshot(f.repo)).stashes.length, 0);
    await mutate(f.repo, "stash.save", { message: "again" });
    await mutate(f.repo, "stash.drop", { ref: "stash@{0}" });
    assert.equal((await snapshot(f.repo)).stashes.length, 0);
  } finally {
    await f.clean();
  }
});
test("merge conflicts are detected and abort restores the repository", async () => {
  const f = await fixture();
  try {
    await f.write("conflict.txt", "base\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await mutate(f.repo, "branch.create", { name: "other" });
    await f.write("conflict.txt", "other\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "other" });
    await mutate(f.repo, "branch.checkout", { name: "main" });
    await f.write("conflict.txt", "main\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "main" });
    await assert.rejects(mutate(f.repo, "merge", { ref: "other" }));
    const s = await snapshot(f.repo);
    assert.equal(s.operation, "merge");
    assert.equal(s.changes[0].conflict, true);
    await mutate(f.repo, "operation.abort", { operation: "merge" });
    assert.equal((await snapshot(f.repo)).operation, null);
    assert.equal((await readFile(f.repo, "conflict.txt")).text, "main\n");
  } finally {
    await f.clean();
  }
});
test("binary files, file size limits, literal pathspecs and traversal guards", async () => {
  const f = await fixture();
  try {
    await f.write("binary.bin", Buffer.from([0, 1, 2]));
    assert.equal((await readFile(f.repo, "binary.bin")).binary, true);
    await f.write("large.txt", "a".repeat(2 * 1024 * 1024 + 1));
    assert.equal((await readFile(f.repo, "large.txt")).truncated, true);
    await f.write("[literal].txt", "literal");
    await f.write("l.txt", "different");
    await mutate(f.repo, "stage", { paths: ["[literal].txt"] });
    const s = await snapshot(f.repo);
    assert.equal(s.changes.find((c) => c.path === "l.txt")?.index, "?");
    await assert.rejects(readFile(f.repo, "../outside.txt"));
    await assert.rejects(readFile(f.repo, ".git/config"));
    await assert.rejects(readFile(f.repo, ".GIT/config"));
    try {
      await fs.symlink(
        path.join(f.repo, ".git/config"),
        path.join(f.repo, "private-link.txt"),
        "file",
      );
      await assert.rejects(readFile(f.repo, "private-link.txt"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    await assert.rejects(
      mutate(f.repo, "stage", { paths: ["../outside.txt"] }),
    );
    assert.equal(
      (await tree(f.repo)).some((e) => e.name === ".git"),
      false,
    );
    await saveFile(f.repo, "[literal].txt", "saved");
    assert.equal((await readFile(f.repo, "[literal].txt")).text, "saved");
  } finally {
    await f.clean();
  }
});
test("clone, fetch, pull, push and preferences use a local bare remote", async () => {
  const f = await fixture();
  try {
    const bare = path.join(f.base, "remote.git");
    await fs.mkdir(bare);
    await git(bare, ["init", "--bare", "--initial-branch=main"]);
    await f.write("a.txt", "base");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await mutate(f.repo, "remote.add", { name: "origin", url: bare });
    await mutate(f.repo, "push", { remote: "origin", branch: "main" });
    const api = createApi({ preferencesPath: path.join(f.base, "prefs.json") });
    const cloned = (await api({
      method: "clone",
      params: { url: bare, path: path.join(f.base, "clone") },
    })) as string;
    assert.equal((await snapshot(cloned)).upstream, "origin/main");
    await f.write("a.txt", "updated");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "update remote" });
    await mutate(f.repo, "push", {});
    await mutate(cloned, "fetch", {});
    assert.equal((await snapshot(cloned)).behind, 1);
    await mutate(cloned, "pull", {});
    assert.equal((await readFile(cloned, "a.txt")).text, "updated");
    await mutate(cloned, "branch.checkout", {
      name: "origin/main",
      remote: true,
    });
    assert.equal((await snapshot(cloned)).branch, "main");
    const bootstrap = (await api({ method: "bootstrap" })) as {
      preferences: { recent: string[] };
    };
    assert.equal(bootstrap.preferences.recent[0], cloned);
    assert.equal(await repository(cloned), cloned.replaceAll("\\", "/"));
  } finally {
    await f.clean();
  }
});

test("resolve and continue a conflicted merge without launching an external editor", async () => {
  const f = await fixture();
  try {
    await f.write("file.txt", "base\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await mutate(f.repo, "branch.create", { name: "other" });
    await f.write("file.txt", "other\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "other" });
    await mutate(f.repo, "branch.checkout", { name: "main" });
    await f.write("file.txt", "main\n");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "main" });
    await assert.rejects(mutate(f.repo, "merge", { ref: "other" }));
    await saveFile(f.repo, "file.txt", "resolved\n");
    await mutate(f.repo, "resolve", { paths: ["file.txt"] });
    assert.equal(
      (await snapshot(f.repo)).changes.some((c) => c.conflict),
      false,
    );
    await mutate(f.repo, "operation.continue", { operation: "merge" });
    const s = await snapshot(f.repo);
    assert.equal(s.operation, null);
    assert.equal(s.commits[0].parents.length, 2);
    assert.equal((await readFile(f.repo, "file.txt")).text, "resolved\n");
  } finally {
    await f.clean();
  }
});

test("rebase, reset modes and hash search preserve the expected Git state", async () => {
  const f = await fixture();
  try {
    await f.write("base.txt", "base");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    const base = (await snapshot(f.repo)).commits[0].hash;
    await mutate(f.repo, "branch.create", { name: "feature" });
    await f.write("feature.txt", "feature");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "feature" });
    await mutate(f.repo, "branch.checkout", { name: "main" });
    await f.write("main.txt", "main");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "main" });
    await mutate(f.repo, "branch.checkout", { name: "feature" });
    await mutate(f.repo, "rebase", { ref: "main" });
    assert.equal((await readFile(f.repo, "main.txt")).text, "main");
    const head = (await snapshot(f.repo)).commits[0].hash;
    assert.equal(
      (await history(f.repo, { search: head.slice(0, 8) }))[0].hash,
      head,
    );
    await mutate(f.repo, "reset", { mode: "soft", ref: base });
    assert.ok((await snapshot(f.repo)).changes.every((c) => c.index === "A"));
    await mutate(f.repo, "reset", { mode: "mixed", ref: head });
    assert.equal((await snapshot(f.repo)).changes.length, 0);
    await f.write("feature.txt", "dirty");
    await mutate(f.repo, "reset", { mode: "hard", ref: head });
    assert.equal((await readFile(f.repo, "feature.txt")).text, "feature");
    await mutate(f.repo, "remote.add", {
      name: "example",
      url: path.join(f.base, "remote.git"),
    });
    await mutate(f.repo, "remote.remove", { name: "example" });
    assert.equal((await snapshot(f.repo)).remotes.length, 0);
  } finally {
    await f.clean();
  }
});

test("snapshot reads do not evict user operations from the command console", async () => {
  const f = await fixture();
  try {
    await f.write("a.txt", "a");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "retained operation" });
    for (let i = 0; i < 205; i++) await git(f.repo, ["--version"]);
    assert.ok(
      commandLogs().some((log) => log.command.includes("retained operation")),
    );
  } finally {
    await f.clean();
  }
});

test("API initializes, opens and remembers an empty repository and validates preferences", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "git-idea-api-"));
  try {
    const api = createApi({ preferencesPath: path.join(base, "prefs.json") });
    const root = (await api({
      method: "init",
      params: { path: path.join(base, "new repo") },
    })) as string;
    const state = (await api({ method: "snapshot", repo: root })) as Awaited<
      ReturnType<typeof snapshot>
    >;
    assert.equal(state.branch, "main");
    assert.equal(state.head, null);
    assert.equal(state.commits.length, 0);
    assert.equal(await api({ method: "open", params: { path: root } }), root);
    await api({
      method: "preferences",
      params: { theme: "light", fontSize: 100 },
    });
    const boot = (await createApi({
      preferencesPath: path.join(base, "prefs.json"),
    })({ method: "bootstrap" })) as {
      preferences: { recent: string[]; fontSize: number };
    };
    assert.deepEqual(boot.preferences.recent, [root]);
    assert.equal(boot.preferences.fontSize, 18);
    await assert.rejects(api({ method: "init", params: {} }));
    await assert.rejects(
      api({ method: "mutate", repo: root, params: { action: "unknown" } }),
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("branch and tag identities remain distinct when their names collide", async () => {
  const f = await fixture();
  try {
    await f.write("base.txt", "base");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "base" });
    await mutate(f.repo, "tag.create", { name: "shared" });
    await mutate(f.repo, "branch.create", { name: "shared" });
    await f.write("branch.txt", "branch");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "branch head" });
    const state = await snapshot(f.repo);
    assert.equal(state.branch, "shared");
    assert.equal(state.branches.find((b) => b.current)?.name, "shared");
    assert.deepEqual(
      state.tags.map((t) => t.name),
      ["shared"],
    );
    assert.equal(
      (await history(f.repo, { ref: "refs/heads/shared" }))[0].subject,
      "branch head",
    );
    assert.equal(
      (await history(f.repo, { ref: "refs/tags/shared" }))[0].subject,
      "base",
    );
    await mutate(f.repo, "branch.create", {
      name: "from-shared",
      start: "refs/heads/shared",
    });
    assert.equal((await snapshot(f.repo)).head?.subject, "branch head");
  } finally {
    await f.clean();
  }
});

test("an unborn current branch preserves other histories and permits empty branch creation", async () => {
  const f = await fixture();
  try {
    await mutate(f.repo, "branch.create", { name: "new-empty" });
    assert.equal((await snapshot(f.repo)).branch, "new-empty");
    await f.write("base.txt", "base");
    await mutate(f.repo, "stage", {});
    await mutate(f.repo, "commit", { message: "existing history" });
    await mutate(f.repo, "tag.create", { name: "retained-history" });
    await git(f.repo, ["switch", "--orphan", "unborn"]);
    const state = await snapshot(f.repo);
    assert.equal(state.head, null);
    assert.equal(state.commits[0]?.subject, "existing history");
    assert.deepEqual(await history(f.repo, { ref: "HEAD" }), []);
    assert.equal(
      (await history(f.repo, { ref: "refs/heads/new-empty" })).length,
      1,
    );
    await git(f.repo, ["update-ref", "-d", "refs/heads/new-empty"]);
    assert.deepEqual(
      await history(f.repo, { ref: "refs/heads/new-empty" }),
      [],
    );
  } finally {
    await f.clean();
  }
});
