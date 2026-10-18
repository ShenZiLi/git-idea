import { useEffect, useRef, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import type { DiffData, Preferences } from "../../shared/types";
import { request } from "../api";
import { ReadonlyDiff } from "./BranchCompare";
import { IconButton } from "./ui";
export function ReadonlyDiffWindow({ id }: { id: string }) {
  const [data, setData] = useState<DiffData | null>(null), [error, setError] = useState(""), [find, setFind] = useState(false), [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null), content = useRef<HTMLDivElement>(null), match = useRef(-1);
  useEffect(() => { void request<{ data: DiffData; preferences: Preferences }>("readonlyBootstrap", undefined, { id }).then(value => {
    setData(value.data); document.documentElement.dataset.theme = value.preferences.theme || "dark";
    if (value.preferences.uiFontFamily) document.documentElement.style.setProperty("--font-ui", value.preferences.uiFontFamily);
    if (value.preferences.editorFontFamily) document.documentElement.style.setProperty("--font-mono", value.preferences.editorFontFamily);
  }).catch(e => setError(e.message)); }, [id]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFind(true); setTimeout(() => search.current?.focus(), 0); } if (e.key === "Escape") setFind(false); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);
  function next(reverse = false) { const rows = Array.from(content.current?.querySelectorAll<HTMLElement>(".compare-code-line") || []), hits = rows.filter(row => query && row.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase())); rows.forEach(row => row.classList.remove("readonly-match")); if (!hits.length) return; match.current = (match.current + (reverse ? -1 : 1) + hits.length) % hits.length; hits[match.current].classList.add("readonly-match"); hits[match.current].scrollIntoView({ block: "center" }); }
  return <div className="readonly-window"><header className="titlebar"><strong>{data?.path || "只读差异"}</strong><span className="muted">只读</span><div style={{ marginLeft: "auto", display: "flex", WebkitAppRegion: "no-drag" } as React.CSSProperties}><IconButton title="查找 Ctrl F" onClick={() => { setFind(true); setTimeout(() => search.current?.focus(), 0); }}><Search size={16}/></IconButton><IconButton title="复制差异内容" disabled={!data || data.binary || data.truncated} onClick={() => void navigator.clipboard.writeText(data?.raw || `${data?.beforeLabel}\n${data?.before}\n\n${data?.afterLabel}\n${data?.after}`)}><Copy size={16}/></IconButton><IconButton title="关闭" onClick={() => window.gitIdea?.window("close")}><X size={16}/></IconButton></div></header>{find && <div className="panel-toolbar"><Search size={15}/><input ref={search} aria-label="查找差异" placeholder="搜索" value={query} onChange={e => { setQuery(e.target.value); match.current = -1; }} onKeyDown={e => { if (e.key === "Enter") next(e.shiftKey); }}/><button onClick={() => next(true)}>上一个</button><button onClick={() => next()}>下一个</button><IconButton title="关闭查找" onClick={() => setFind(false)}><X size={15}/></IconButton></div>}<div className="readonly-content" ref={content}>{error ? <div className="form-error">{error}</div> : data ? <ReadonlyDiff data={data}/> : <div className="group-empty">正在加载…</div>}</div></div>;
}
