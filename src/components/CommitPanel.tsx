import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, GitCommitHorizontal, Minus, Plus, RefreshCw, RotateCcw, Settings2 } from 'lucide-react';
import type { Change, RepoSnapshot } from '../../shared/types';
import { Empty, FileIcon, Group, IconButton, PanelHeader, Spinner } from './ui';

export const isStaged = (c: Change) => c.index !== ' ' && c.index !== '?' && !c.conflict;
export const isUnstaged = (c: Change) => c.worktree !== ' ' || c.conflict;
export function CommitPanel({ snapshot: s, busy, mutate, openDiff, refresh, confirm, settings }: {
  snapshot: RepoSnapshot | null; busy: boolean; mutate: (action: string, params?: Record<string, unknown>) => Promise<boolean>; openDiff: (path: string, staged?: boolean) => void;
  refresh: () => void; confirm: (title: string, message: string, action: () => Promise<unknown>) => void; settings: () => void;
}) {
  const [message, setMessage] = useState(''), [amend, setAmend] = useState(false), [stagedOpen, setStagedOpen] = useState(true), [workingOpen, setWorkingOpen] = useState(true);
  const [localError, setLocalError] = useState('');
  const staged = s?.changes.filter(isStaged) || [], unstaged = s?.changes.filter(isUnstaged) || [];
  useEffect(() => { setMessage(''); setAmend(false); setLocalError(''); }, [s?.root]);
  async function commit(push = false) {
    if (!message.trim()) { setLocalError('请输入提交信息'); return; }
    if (!staged.length && !amend) { setLocalError('请先暂存要提交的文件'); return; }
    setLocalError(''); if (await mutate('commit', { message, amend })) { setMessage(''); setAmend(false); if (push) await mutate('push', {}); }
  }
  const file = (c: Change, stage: boolean) => <div key={`${c.path}-${stage}`} className={`change-row ${c.conflict ? 'conflicted' : ''}`}>
    <input aria-label={`${stage ? '取消暂存' : '暂存'} ${c.path}`} type="checkbox" checked={stage} disabled={busy || c.conflict} onChange={() => void mutate(stage ? 'unstage' : 'stage', { paths: [c.path] })} />
    <button title={c.path} onClick={() => openDiff(c.path, stage)}><FileIcon name={c.path} /><span className="truncate">{c.path.split('/').at(-1)}</span><span className={`change-letter ${c.conflict ? 'conflicted' : c.index === '?' ? 'untracked' : 'modified'}`}>{c.conflict ? '!' : c.index === '?' ? 'U' : stage ? c.index : c.worktree}</span></button>
    {c.conflict && <IconButton title={`标记 ${c.path} 已解决`} disabled={busy} onClick={() => confirm('标记冲突已解决', `确认已编辑并保存 ${c.path}，且已经移除所有冲突标记？`, () => mutate('resolve', { paths: [c.path] }))}><Check size={13} /></IconButton>}
    {!stage && <IconButton title={`丢弃 ${c.path} 的工作区改动`} disabled={busy || c.conflict} onClick={() => confirm('丢弃工作区改动', `文件：${c.path}\n未暂存的改动将被丢弃；未跟踪的文件会被删除。`, () => mutate('discard', { paths: [c.path] }))}><RotateCcw size={12} /></IconButton>}
  </div>;
  return <section className="commit-panel panel"><PanelHeader title="提交" count={s?.changes.length || 0}><IconButton title="提交设置" onClick={settings}><Settings2 size={14} /></IconButton></PanelHeader>
    <div className="panel-toolbar"><IconButton title="刷新更改" disabled={busy} onClick={refresh}><RefreshCw size={15} /></IconButton><IconButton title="暂存所有更改" disabled={busy || !unstaged.length} onClick={() => void mutate('stage')}><Plus size={16} /></IconButton><IconButton title="取消全部暂存" disabled={busy || !staged.length} onClick={() => void mutate('unstage')}><Minus size={16} /></IconButton><span className="toolbar-divider" /><span className="tiny muted">{staged.length} 个文件待提交</span></div>
    {s?.operation && <div className="operation-banner"><AlertTriangle size={14} /><span>正在进行 {s.operation}</span><button onClick={() => confirm('中止 Git 操作', `中止当前的 ${s.operation} 操作并恢复原状态？`, () => mutate('operation.abort', { operation: s.operation }))}>中止</button><button disabled={s.changes.some(c => c.conflict)} onClick={() => void mutate('operation.continue', { operation: s.operation })}>继续</button></div>}
    <div className="changes-scroll"><Group name="已暂存" count={staged.length} open={stagedOpen} onToggle={() => setStagedOpen(!stagedOpen)}>{staged.length ? staged.map(c => file(c, true)) : <div className="group-empty">暂存后，文件会显示在这里</div>}</Group>
      <Group name="工作区更改" count={unstaged.length} open={workingOpen} onToggle={() => setWorkingOpen(!workingOpen)}>{unstaged.map(c => file(c, false))}</Group>
      {s && !s.changes.length && <Empty icon={<Check size={26} className="green" />} title="工作区干净"><span>所有更改均已提交</span></Empty>}
    </div>
    <div className="commit-form"><div className="commit-options"><label className="checkbox-label"><input type="checkbox" checked={amend} disabled={!s?.commits.length || busy} onChange={e => { setAmend(e.target.checked); if (e.target.checked) setMessage(s?.commits.find(c => c.refs.includes('HEAD'))?.subject || s?.commits[0]?.subject || ''); }} />修订上次提交</label><ChevronDown size={12} /></div>
      <textarea aria-label="提交信息" value={message} onChange={e => { setMessage(e.target.value); setLocalError(''); }} placeholder="提交信息…" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void commit(); } }} disabled={busy || !s} />
      {localError && <div className="form-error" role="alert">{localError}</div>}
      {s && (!s.identity.name || !s.identity.email) && <button className="identity-warning" onClick={settings}><AlertTriangle size={12} />设置提交者姓名和邮箱</button>}
      <div className="commit-actions"><button className="primary" disabled={busy || !s || (!staged.length && !amend)} onClick={() => void commit()}>{busy ? <Spinner /> : <GitCommitHorizontal size={14} />}提交<span className="key-hint">Ctrl ↵</span></button><button disabled={busy || !s?.remotes.length || (!staged.length && !amend)} onClick={() => confirm('提交并推送', '提交已暂存的文件，然后推送到当前分支的上游远程仓库。', () => commit(true))}>提交并推送…</button></div>
    </div>
  </section>;
}
