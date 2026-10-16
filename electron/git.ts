import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Branch, Change, ChangedFile, CommandLog, Commit, CommitDetail, DiffData, RepoSnapshot, TreeEntry } from '../shared/types';

const MAX_TEXT = 2 * 1024 * 1024;
const logs: CommandLog[] = [];
let sequence = 0;
const locks = new Map<string, Promise<unknown>>();
export const commandLogs = () => logs.slice(-150);
function redact(value: string) { return value.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@'); }

export async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    // stash invokes clean internally; a global literal-pathspec flag breaks its cleanup.
    const literalPaths = ['add', 'rm', 'reset', 'restore', 'clean', 'diff', 'log'].includes(args[0]);
    const child = spawn('git', ['--no-pager', ...(literalPaths ? ['--literal-pathspecs'] : []), '-c', 'core.quotepath=false', ...args], {
      cwd, windowsHide: true, shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [], err: Buffer[] = [];
    let bytes = 0, killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16 * MAX_TEXT) { killed = true; child.kill(); } else out.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { if (err.reduce((n, b) => n + b.length, 0) < MAX_TEXT) err.push(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(new Error(error.message.includes('ENOENT') ? '找不到 Git。请安装 Git 并确保它位于系统 PATH 中。' : error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      const output = killed ? 'Git 操作超时或输出超过限制，请在控制台检查仓库。' : (stderr || stdout);
      logs.push({ id: ++sequence, date: new Date().toISOString(), command: redact(`git ${args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`), output: redact(output.slice(0, 12000)), success: code === 0 && !killed, duration: Date.now() - start });
      if (logs.length > 200) logs.shift();
      if (code === 0 && !killed) resolve(stdout);
      else reject(new Error(redact(output.trim() || `Git 退出码 ${code}`)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function repository(directory: string): Promise<string> {
  if (!directory || typeof directory !== 'string') throw new Error('请选择仓库目录');
  return (await git(path.resolve(directory), ['rev-parse', '--show-toplevel'])).trim();
}
export async function serialize<T>(repo: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(repo) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  locks.set(repo, current);
  try { return await current; } finally { if (locks.get(repo) === current) locks.delete(repo); }
}
export function relativeFile(repo: string, file: string): string {
  if (!file || typeof file !== 'string' || file.includes('\0') || path.isAbsolute(file) || /^[A-Za-z]:/.test(file)) throw new Error('无效的仓库内路径');
  const result = path.resolve(repo, file);
  const relative = path.relative(repo, result);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).includes('.git')) throw new Error('文件必须位于仓库目录内');
  return relative.split(path.sep).join('/');
}
async function safeDiskPath(repo: string, file: string) {
  const relative = relativeFile(repo, file);
  const diskPath = await fs.realpath(path.join(repo, relative));
  const realRoot = await fs.realpath(repo);
  const check = path.relative(realRoot, diskPath);
  if (check === '..' || check.startsWith(`..${path.sep}`) || path.isAbsolute(check)) throw new Error('不读取仓库外部的符号链接');
  return diskPath;
}
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
async function hasHead(repo: string) { try { await git(repo, ['rev-parse', '--verify', 'HEAD']); return true; } catch { return false; } }
async function config(repo: string, key: string) { try { return (await git(repo, ['config', '--get', key])).trim(); } catch { return ''; } }
export async function resolveCommit(repo: string, ref: string) {
  if (!ref || ref.startsWith('-') || ref.includes('\0') || ref.length > 500) throw new Error('无效的 Git 引用');
  return (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
export function parseStatus(raw: string): Change[] {
  const parts = raw.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]; if (line.length < 4) continue;
    const index = line[0], worktree = line[1], file = line.slice(3);
    const oldPath = /[RC]/.test(index + worktree) ? parts[++i] : undefined;
    changes.push({ path: file, oldPath, index, worktree, conflict: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(index + worktree) });
  }
  return changes;
}
function parseLog(raw: string): Commit[] {
  return raw.split('\x1e').map(row => row.replace(/^\s+/, '')).filter(Boolean).map(row => {
    const [hash, parents, author, email, date, subject, refs, body] = row.split('\0');
    return { hash, parents: parents ? parents.split(' ') : [], author, email, date, subject, refs, body: (body ?? '').trim() };
  });
}
const logFormat = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00%b%x1e';
export async function history(repo: string, params: Record<string, unknown> = {}): Promise<Commit[]> {
  if (!(await hasHead(repo))) return [];
  const args = ['log', '--topo-order', `--format=${logFormat}`, `--max-count=${Math.min(Math.max(Number(params.limit) || 300, 1), 3000)}`];
  if (params.ref) args.push(await resolveCommit(repo, String(params.ref))); else args.push('--all', 'HEAD');
  if (params.search) args.push('--regexp-ignore-case', '--fixed-strings', `--grep=${String(params.search)}`);
  if (params.author) args.push(`--author=${String(params.author)}`);
  if (params.since) args.push(`--since=${String(params.since)}`);
  if (params.file) args.push('--', relativeFile(repo, String(params.file)));
  return parseLog(await git(repo, args));
}
export async function snapshot(repo: string, params: Record<string, unknown> = {}): Promise<RepoSnapshot> {
  const [status, branch, refRows, tagRows, remoteRows, stashRows, commits, name, email, version, gitDir] = await Promise.all([
    git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(repo, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => git(repo, ['rev-parse', '--short', 'HEAD'])),
    git(repo, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname)%00%(upstream:track)', 'refs/heads', 'refs/remotes']),
    git(repo, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/tags']),
    git(repo, ['remote']),
    git(repo, ['stash', 'list', '--format=%gd%x00%gs%x00%aI']),
    history(repo, params), config(repo, 'user.name'), config(repo, 'user.email'), git(repo, ['--version']), git(repo, ['rev-parse', '--absolute-git-dir']),
  ]);
  const branches: Branch[] = refRows.trim().split('\n').filter(Boolean).map(row => {
    const [ref, name, head, upstream, hash, track] = row.split('\0');
    return { name, ref, current: head === '*', upstream, hash, track, remote: ref.startsWith('refs/remotes/') };
  }).filter(b => !b.name.endsWith('/HEAD'));
  const current = branches.find(b => b.current);
  let ahead = 0, behind = 0;
  if (current?.upstream) {
    const counts = (await git(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).catch(() => '0\t0')).trim().split(/\s+/);
    [ahead, behind] = counts.map(Number);
  }
  const operation = await exists(path.join(gitDir.trim(), 'rebase-merge')) || await exists(path.join(gitDir.trim(), 'rebase-apply')) ? 'rebase'
    : await exists(path.join(gitDir.trim(), 'MERGE_HEAD')) ? 'merge' : await exists(path.join(gitDir.trim(), 'CHERRY_PICK_HEAD')) ? 'cherry-pick'
    : await exists(path.join(gitDir.trim(), 'REVERT_HEAD')) ? 'revert' : null;
  return { root: repo, name: path.basename(repo), branch: branch.trim(), upstream: current?.upstream ?? '', ahead, behind,
    changes: parseStatus(status), branches, tags: tagRows.trim().split('\n').filter(Boolean).map(row => { const [name, hash] = row.split('\0'); return { name, hash }; }),
    remotes: await Promise.all(remoteRows.trim().split('\n').filter(Boolean).map(async name => ({ name, url: (await git(repo, ['remote', 'get-url', name])).trim() }))),
    stashes: stashRows.trim().split('\n').filter(Boolean).map(row => { const [ref, message, date] = row.split('\0'); return { ref, message, date }; }),
    commits, hasMore: commits.length >= (Number(params.limit) || 300), operation, identity: { name, email }, gitVersion: version.trim() };
}
export async function tree(repo: string, directory = ''): Promise<TreeEntry[]> {
  const diskPath = directory ? await safeDiskPath(repo, directory) : repo;
  return (await fs.readdir(diskPath, { withFileTypes: true })).filter(e => e.name !== '.git').map(e => ({
    name: e.name, path: [directory, e.name].filter(Boolean).join('/'), directory: e.isDirectory(), symlink: e.isSymbolicLink(),
  })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
export async function readFile(repo: string, file: string): Promise<{ text: string; binary: boolean; truncated: boolean }> {
  const diskPath = await safeDiskPath(repo, file);
  const handle = await fs.open(diskPath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择普通文件');
    const data = Buffer.alloc(Math.min(stat.size, MAX_TEXT));
    await handle.read(data, 0, data.length, 0);
    const binary = data.subarray(0, 8192).includes(0);
    return { text: binary ? '' : data.toString('utf8'), binary, truncated: stat.size > MAX_TEXT };
  } finally { await handle.close(); }
}
async function blob(repo: string, rev: string, file: string) {
  const size = Number((await git(repo, ['cat-file', '-s', `${rev}:${file}`]).catch(() => '0')).trim());
  if (size > MAX_TEXT) return { text: '', truncated: true, binary: false };
  const text = await git(repo, ['show', `${rev}:${file}`]).catch(() => '');
  return { text: text.includes('\0') ? '' : text, binary: text.includes('\0'), truncated: false };
}
async function emptyTree(repo: string) { return (await git(repo, ['hash-object', '-t', 'tree', '--stdin'], '')).trim(); }
export async function diff(repo: string, params: Record<string, unknown>): Promise<DiffData> {
  const file = relativeFile(repo, String(params.path ?? ''));
  let before, after, raw = '', beforeLabel = 'HEAD', afterLabel = '工作区';
  if (params.commit) {
    const hash = await resolveCommit(repo, String(params.commit));
    const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ').slice(1);
    const parent = parents[0] || await emptyTree(repo);
    const oldFile = params.oldPath ? relativeFile(repo, String(params.oldPath)) : file;
    [before, after, raw] = await Promise.all([blob(repo, parent, oldFile), blob(repo, hash, file), git(repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', parent, hash, '--', ...new Set([oldFile, file])])]);
    beforeLabel = parents[0]?.slice(0, 8) || '空文件'; afterLabel = hash.slice(0, 8);
  } else {
    const head = await hasHead(repo);
    const changes = parseStatus(await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const change = changes.find(c => c.path === file);
    const oldFile = change?.oldPath || file;
    if (params.staged) {
      [before, after, raw] = await Promise.all([head ? blob(repo, 'HEAD', oldFile) : Promise.resolve({ text: '', binary: false, truncated: false }), blob(repo, '', file), git(repo, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', ...new Set([file, oldFile])])]);
      afterLabel = '暂存区';
    } else {
      before = await blob(repo, '', file); beforeLabel = '暂存区';
      try { after = await readFile(repo, file); } catch (error) { if (change?.worktree === 'D') after = { text: '', binary: false, truncated: false }; else throw error; }
      raw = await git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--', file]);
      if (change?.index === '?' && change.worktree === '?') before = { text: '', binary: false, truncated: false };
    }
  }
  return { path: file, before: before.text, after: after.text, raw, beforeLabel, afterLabel, binary: before.binary || after.binary, truncated: before.truncated || after.truncated };
}
export async function commitDetail(repo: string, ref: string): Promise<CommitDetail> {
  const hash = await resolveCommit(repo, ref);
  const commit = parseLog(await git(repo, ['show', '-s', `--format=${logFormat}`, hash]))[0];
  const parent = commit.parents[0] || await emptyTree(repo);
  const [names, stats] = await Promise.all([git(repo, ['diff', '-M', '--name-status', '-z', parent, hash]), git(repo, ['diff', '-M', '--numstat', '-z', parent, hash])]);
  const files: ChangedFile[] = [];
  const parts = names.split('\0');
  for (let i = 0; i < parts.length && parts[i]; i++) {
    const status = parts[i], first = parts[++i], rename = /^[RC]/.test(status);
    files.push({ path: rename ? parts[++i] : first, oldPath: rename ? first : undefined, status: status[0], additions: 0, deletions: 0 });
  }
  const counts = stats.split('\0');
  for (let i = 0; i < counts.length && counts[i]; i++) {
    const [add, del, file] = counts[i].split('\t');
    let target = file;
    if (!file) { i++; target = counts[++i]; }
    const entry = files.find(f => f.path === target);
    if (entry) { entry.additions = Number(add) || 0; entry.deletions = Number(del) || 0; }
  }
  return { commit, files };
}

function string(params: Record<string, unknown>, key: string, optional = false): string {
  const value = params[key];
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.includes('\0')) throw new Error(`请填写 ${key}`);
  return value;
}
async function branchName(repo: string, value: string) {
  if (value.startsWith('-')) throw new Error('分支名不能以 - 开头');
  await git(repo, ['check-ref-format', '--branch', value]); return value;
}
export async function mutate(repo: string, action: string, params: Record<string, unknown>): Promise<string> {
  return serialize(repo, async () => {
    const paths = Array.isArray(params.paths) ? params.paths.map(p => relativeFile(repo, String(p))) : [];
    switch (action) {
      case 'stage': return git(repo, ['add', '--', ...(paths.length ? paths : ['.'])]);
      case 'unstage': return await hasHead(repo) ? git(repo, ['reset', '--', ...(paths.length ? paths : ['.'])]) : git(repo, ['rm', '--cached', '-r', '--', ...(paths.length ? paths : ['.'])]);
      case 'discard': {
        if (!paths.length) throw new Error('请选择要丢弃改动的文件');
        const changes = parseStatus(await git(repo, ['status', '--porcelain=v1', '-z']));
        for (const file of paths) {
          const change = changes.find(c => c.path === file);
          if (!change) continue;
          if (change.index === '?') await git(repo, ['clean', '-f', '--', file]);
          else await git(repo, ['restore', '--worktree', '--', file]);
        }
        return '工作区改动已丢弃';
      }
      case 'commit': return git(repo, ['commit', ...(params.amend ? ['--amend'] : []), '-m', string(params, 'message')]);
      case 'branch.create': return git(repo, ['switch', '-c', await branchName(repo, string(params, 'name')), ...(params.start ? [await resolveCommit(repo, string(params, 'start'))] : [])]);
      case 'branch.checkout': {
        const name = await branchName(repo, string(params, 'name'));
        if (params.remote) {
          const branch = name.slice(name.indexOf('/') + 1);
          return git(repo, ['switch', '--track', '-c', branch, name]);
        }
        return git(repo, ['switch', name]);
      }
      case 'branch.rename': return git(repo, ['branch', '-m', await branchName(repo, string(params, 'name')), await branchName(repo, string(params, 'newName'))]);
      case 'branch.delete': return git(repo, ['branch', '-d', await branchName(repo, string(params, 'name'))]);
      case 'merge': return git(repo, ['merge', '--no-edit', await resolveCommit(repo, string(params, 'ref'))]);
      case 'rebase': return git(repo, ['rebase', await resolveCommit(repo, string(params, 'ref'))]);
      case 'cherry-pick': return git(repo, ['cherry-pick', await resolveCommit(repo, string(params, 'ref'))]);
      case 'revert': return git(repo, ['revert', '--no-edit', await resolveCommit(repo, string(params, 'ref'))]);
      case 'tag.create': {
        const name = string(params, 'name'); await git(repo, ['check-ref-format', `refs/tags/${name}`]);
        return git(repo, ['tag', name, await resolveCommit(repo, String(params.ref || 'HEAD'))]);
      }
      case 'tag.delete': return git(repo, ['tag', '-d', '--', string(params, 'name')]);
      case 'stash.save': return git(repo, ['stash', 'push', '--include-untracked', '-m', string(params, 'message', true) || 'Git IDEA stash']);
      case 'stash.apply': case 'stash.pop': case 'stash.drop': {
        const ref = string(params, 'ref'); if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('无效的储藏引用');
        return git(repo, ['stash', action.split('.')[1], ref]);
      }
      case 'fetch': return git(repo, ['fetch', '--all', '--prune']);
      case 'pull': return git(repo, ['pull', '--ff-only']);
      case 'push': {
        const args = ['push'];
        if (params.remote) {
          const remote = string(params, 'remote'); if (remote.startsWith('-')) throw new Error('无效的远程名称');
          args.push('--set-upstream', remote, await branchName(repo, string(params, 'branch')));
        }
        return git(repo, args);
      }
      case 'remote.add': case 'remote.remove': {
        const name = string(params, 'name'); if (!/^[\w.-]+$/.test(name) || name.startsWith('-')) throw new Error('无效的远程名称');
        return git(repo, ['remote', action.endsWith('add') ? 'add' : 'remove', name, ...(action.endsWith('add') ? [string(params, 'url')] : [])]);
      }
      case 'identity': {
        await git(repo, ['config', '--local', 'user.name', string(params, 'name')]);
        await git(repo, ['config', '--local', 'user.email', string(params, 'email')]);
        return '仓库提交身份已保存';
      }
      case 'resolve': {
        if (!paths.length) throw new Error('请选择冲突文件');
        return git(repo, ['add', '--', ...paths]);
      }
      case 'operation.abort': case 'operation.continue': {
        const operation = string(params, 'operation');
        if (!['merge', 'rebase', 'cherry-pick', 'revert'].includes(operation)) throw new Error('未知操作');
        return git(repo, ['-c', 'core.editor=true', operation, action.endsWith('abort') ? '--abort' : '--continue'], undefined);
      }
      case 'reset': {
        const mode = string(params, 'mode'); if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error('未知重置模式');
        return git(repo, ['reset', `--${mode}`, await resolveCommit(repo, string(params, 'ref'))]);
      }
      default: throw new Error('不支持的 Git 操作');
    }
  });
}

export async function saveFile(repo: string, file: string, text: string) {
  if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('文件过大，请使用外部编辑器');
  const diskPath = await safeDiskPath(repo, file);
  const stat = await fs.stat(diskPath); if (!stat.isFile()) throw new Error('只能保存普通文件');
  await fs.writeFile(diskPath, text, 'utf8');
  return '文件已保存';
}
