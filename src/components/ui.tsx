import { ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, GitBranch, LoaderCircle, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function IconButton({ title, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; active?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${rest.className || ''}`} aria-label={title} title={title} {...rest}>{children}</button>;
}
export function FileIcon({ name, folder, open }: { name: string; folder?: boolean; open?: boolean }) {
  if (folder) return open ? <FolderOpen size={16} className="folder-icon" /> : <Folder size={16} className="folder-icon" />;
  const ext = name.split('.').pop();
  if (ext === 'json') return <FileJson size={15} className="file-json" />;
  if (['ts', 'tsx', 'js', 'jsx', 'css', 'html', 'py', 'rs', 'go'].includes(ext || '')) return <FileCode2 size={15} className={`file-code file-${ext}`} />;
  return <FileText size={15} className={ext === 'md' ? 'file-markdown' : 'muted'} />;
}
export function BranchLabel({ name }: { name: string }) { return <span className="branch-label"><GitBranch size={13} />{name}</span>; }
export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) { return <div className="empty-state">{icon}<strong>{title}</strong>{children && <span>{children}</span>}</div>; }
export function Spinner() { return <LoaderCircle size={14} className="spin" />; }
export function PanelHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return <div className="panel-header"><span>{title}{count !== undefined && <span className="count">{count}</span>}</span><div className="actions">{children}</div></div>;
}
export function Close({ onClick }: { onClick: () => void }) { return <IconButton title="关闭" onClick={onClick}><X size={15} /></IconButton>; }
export function Group({ name, children, open, onToggle, count }: { name: string; children: ReactNode; open: boolean; onToggle: () => void; count?: number }) {
  return <section className="tree-group"><button className="group-title" onClick={onToggle}><ChevronRight size={13} className={open ? 'rotate' : ''} />{name}{count !== undefined && <span className="count">{count}</span>}</button>{open && children}</section>;
}
export function dateTime(value: string, short = false) {
  const d = new Date(value); if (Number.isNaN(d.valueOf())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...(short ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
