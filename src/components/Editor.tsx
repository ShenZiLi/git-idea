import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Columns2, Copy, Edit3, FileCode2, GitCompareArrows, Rows3, Save, Search, WrapText, X } from 'lucide-react';
import type { DiffData } from '../../shared/types';
import { request } from '../api';
import { diffRows } from '../diff';
import { Empty, FileIcon, IconButton, Spinner } from './ui';

export interface EditorTab { id: string; path: string; kind: 'file' | 'diff'; staged?: boolean; commit?: string; oldPath?: string }
function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\/\/.*$|#[^#].*$|"[^"\n]*"|'[^'\n]*'|\b(?:const|let|export|import|from|return|async|await|function|interface|type|if|else|true|false|null|class|new)\b|\b\d+(?:\.\d+)?\b)/g);
  return <>{parts.map((part, i) => <span key={i} className={/^['"]/.test(part) ? 'syntax-string' : /^(\/\/|#)/.test(part) ? 'syntax-comment' : /^\d/.test(part) ? 'syntax-number' : /^(const|let|export|import|from|return|async|await|function|interface|type|if|else|true|false|null|class|new)$/.test(part) ? 'syntax-keyword' : undefined}>{part}</span>)}</>;
}
export function Editor({ repo, tab, tabs, active, onSelect, onClose, version, onSaved, onDirty, notify, welcome }: {
  repo: string; tab?: EditorTab; tabs: EditorTab[]; active: string; onSelect: (id: string) => void; onClose: (id: string) => void; version: number;
  onSaved: () => void; onDirty: (dirty: boolean) => void; notify: (message: string, error?: boolean) => void; welcome: React.ReactNode;
}) {
  const [data, setData] = useState<DiffData | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [split, setSplit] = useState(true), [wrap, setWrap] = useState(false), [ignoreWhitespace, setIgnoreWhitespace] = useState(false), [search, setSearch] = useState('');
  const [edit, setEdit] = useState(false), [draft, setDraft] = useState(''), [saving, setSaving] = useState(false), [showAll, setShowAll] = useState(false);
  const dirty = edit && draft !== data?.after;
  const dirtyRef = useRef(false), loadedTab = useRef('');
  dirtyRef.current = dirty;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!tab || !repo) { setData(null); return; }
    if (dirtyRef.current && loadedTab.current === `${repo}:${tab.id}`) return;
    let current = true; setLoading(true); setError(''); setEdit(false); setShowAll(false);
    const query = tab.kind === 'diff' ? request<DiffData>('diff', repo, { path: tab.path, staged: tab.staged, commit: tab.commit, oldPath: tab.oldPath }) : request<{ text: string; binary: boolean; truncated: boolean }>('file', repo, { path: tab.path }).then(file => ({ path: tab.path, before: '', after: file.text, raw: '', binary: file.binary, truncated: file.truncated, beforeLabel: '', afterLabel: '工作区' }));
    query.then(v => { if (current) { loadedTab.current = `${repo}:${tab.id}`; setData(v); setDraft(v.after); } }).catch(e => current && setError(e.message)).finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [repo, tab?.id, version]);
  const rows = useMemo(() => data && tab?.kind === 'diff' ? diffRows(data.before, data.after, ignoreWhitespace) : [], [data, tab?.kind, ignoreWhitespace]);
  const fileLines = data?.after.replaceAll('\r\n', '\n').split('\n') || [];
  const matches = useMemo(() => rows.map((row, i) => row.kind !== 'same' ? i : -1).filter(i => i >= 0), [rows]);
  const jump = (direction: number) => { const container = document.querySelector('.code-scroll'); if (!container) return; const current = Math.floor(container.scrollTop / 22); const match = direction > 0 ? matches.find(i => i > current + 1) ?? matches[0] : [...matches].reverse().find(i => i < current - 1) ?? matches.at(-1); if (match !== undefined) container.scrollTo({ top: Math.max(0, match * 22 - 44), behavior: 'smooth' }); };
  const save = async () => { if (!tab) return; setSaving(true); try { await request('saveFile', repo, { path: tab.path, text: draft }); setEdit(false); onSaved(); notify('文件已保存'); } catch (e) { notify((e as Error).message, true); } finally { setSaving(false); } };
  const codeMatch = (text?: string) => search && text?.toLowerCase().includes(search.toLowerCase()) ? ' search-match' : '';
  return <section className="editor-panel panel">
    <div className="editor-tabs">{tabs.map(t => <div className={`editor-tab ${active === t.id ? 'active' : ''}`} key={t.id}>
      <button title={t.path} onClick={() => onSelect(t.id)}><FileIcon name={t.path} /><span>{t.path.split('/').at(-1)}</span>{t.kind === 'diff' && <GitCompareArrows size={12} className="muted" />}{t.commit && <span className="tiny muted">{t.commit.slice(0, 7)}</span>}{t.staged && <span className="tiny muted">暂存</span>}</button>
      <IconButton title={`关闭 ${t.path.split('/').at(-1)}`} onClick={() => onClose(t.id)}><X size={12} /></IconButton></div>)}
      <div className="editor-tabs-fill" /><IconButton title="关闭所有标签" disabled={!tabs.length} onClick={() => tabs.forEach(t => onClose(t.id))}><X size={14} /></IconButton>
    </div>
    {!tab ? welcome : <>
      <div className="editor-toolbar"><span className="truncate editor-path">{tab.path.split('/').map((part, i, arr) => <span key={i}>{part}{i < arr.length - 1 && <span className="path-divider"> / </span>}</span>)}</span>
        {tab.kind === 'diff' && <><IconButton title="上一个差异" onClick={() => jump(-1)}><ArrowUp size={14} /></IconButton><IconButton title="下一个差异" onClick={() => jump(1)}><ArrowDown size={14} /></IconButton><span className="toolbar-divider" /><IconButton title="并排差异" active={split} onClick={() => setSplit(true)}><Columns2 size={15} /></IconButton><IconButton title="统一差异" active={!split} onClick={() => setSplit(false)}><Rows3 size={15} /></IconButton></>}
        <IconButton title="自动换行" active={wrap} onClick={() => setWrap(!wrap)}><WrapText size={15} /></IconButton>
        {!tab.commit && <IconButton title="编辑工作区文件" disabled={tab.staged || data?.binary || data?.truncated || loading} active={edit} onClick={() => setEdit(!edit)}><Edit3 size={14} /></IconButton>}
        <IconButton title="复制文件内容" disabled={!data} onClick={() => { navigator.clipboard.writeText(data?.after || '').then(() => notify('已复制文件内容')).catch(() => notify('复制失败，请使用系统复制快捷键', true)); }}><Copy size={14} /></IconButton>
      </div>
      {loading ? <div className="editor-loading"><Spinner />读取文件…</div> : error ? <Empty title="无法显示文件"><span className="error-text">{error}</span></Empty> : data?.binary ? <Empty icon={<FileCode2 size={30} />} title="二进制文件"><span>此文件无法显示文本差异</span></Empty> : edit ? <div className="edit-area"><div className="edit-banner"><span>编辑工作区 · {tab.path}</span><button className="primary small" disabled={saving} onClick={save}>{saving ? <Spinner /> : <Save size={13} />}保存文件</button><button className="small" onClick={() => { setDraft(data?.after || ''); setEdit(false); }}>取消</button></div><textarea aria-label="文件内容" spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } }} /></div> : <>
        {tab.kind === 'diff' && <div className={`diff-labels ${split ? 'split' : ''}`}><span><span className="diff-dot old" />{data?.beforeLabel}<small>原始版本</small></span><span><span className="diff-dot new" />{data?.afterLabel}<small>{tab.commit ? '提交版本' : '修改后的内容'}</small></span></div>}
        <div className={`code-scroll ${wrap ? 'wrap-code' : ''}`}>
          {data?.truncated && <div className="inline-warning">文件超过 2 MB，内容已限制。请使用外部编辑器处理完整文件。</div>}
          {tab.kind === 'file' ? <div className="code-document">{fileLines.slice(0, showAll ? undefined : 3000).map((line, i) => <div key={i} className={`code-line${codeMatch(line)}`}><span className="line-number">{i + 1}</span><code><Highlight text={line} /></code></div>)}</div> : rows.length ? <div className={`diff-content ${split ? 'split' : 'unified'}`}>{rows.slice(0, showAll ? undefined : 3000).map((row, i) => split ? <div className={`diff-row ${row.kind}`} key={i}>
            <div className={`code-line old-side ${row.kind !== 'same' && row.before !== undefined ? 'removed' : ''}${codeMatch(row.before)}`}><span className="line-number">{row.oldNumber}</span><code><Highlight text={row.before ?? ''} /></code></div>
            <div className={`code-line new-side ${row.kind !== 'same' && row.after !== undefined ? 'added' : ''}${codeMatch(row.after)}`}><span className="line-number">{row.newNumber}</span><code><Highlight text={row.after ?? ''} /></code></div>
          </div> : <div key={i}>{row.kind !== 'same' && row.before !== undefined && <div className={`code-line removed${codeMatch(row.before)}`}><span className="line-number">{row.oldNumber}</span><span className="line-number" /><span className="diff-sign">−</span><code><Highlight text={row.before} /></code></div>}{row.after !== undefined && <div className={`code-line ${row.kind !== 'same' ? 'added' : ''}${codeMatch(row.after)}`}><span className="line-number">{row.kind === 'same' ? row.oldNumber : ''}</span><span className="line-number">{row.newNumber}</span><span className="diff-sign">{row.kind === 'same' ? ' ' : '+'}</span><code><Highlight text={row.after} /></code></div>}</div>)}</div> : <Empty icon={<Check size={26} />} title="内容相同" />}
          {!showAll && (rows.length > 3000 || (tab.kind === 'file' && fileLines.length > 3000)) && <button className="load-more" onClick={() => setShowAll(true)}>显示全部行</button>}
        </div>
        <div className="editor-footer"><Search size={12} /><input aria-label="在文件中查找" placeholder="在文件中查找…" value={search} onChange={e => setSearch(e.target.value)} />{tab.kind === 'diff' && <><label className="checkbox-label"><input type="checkbox" checked={ignoreWhitespace} onChange={e => setIgnoreWhitespace(e.target.checked)} />忽略空白</label><span className="muted">{matches.length} 处改动</span></>}<span className="spacer" /><span>UTF-8</span><span>{data?.after.includes('\r\n') ? 'CRLF' : 'LF'}</span></div>
      </>}
    </>}
  </section>;
}
