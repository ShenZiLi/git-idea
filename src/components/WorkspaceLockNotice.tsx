import { useEffect, useRef, useState } from "react";
import { request } from "../api";
interface LockInfo {
  exists: boolean;
  token?: string;
  pid?: number;
  createdAt?: string;
  dead?: boolean;
  canRelease: boolean;
  reason?: string;
  indexLock?: { exists: boolean; owned: boolean; reason?: string };
}
export function WorkspaceLockNotice({
  repo,
  refresh,
  confirm,
}: {
  repo: string;
  refresh: () => Promise<void>;
  confirm: (
    title: string,
    message: string,
    action: () => Promise<unknown>,
  ) => void;
}) {
  const [info, setInfo] = useState<LockInfo | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const active = useRef(true),
    currentRepo = useRef(repo),
    pending = useRef(false);
  currentRepo.current = repo;
  useEffect(() => {
    active.current = true;
    let current = true;
    setInfo(null);
    setError("");
    void request<LockInfo>("workspaceLockInfo", repo)
      .then((value) => {
        if (current) setInfo(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [repo, revision]);
  if (!info?.exists)
    return error ? <div className="form-error">{error}</div> : null;
  return (
    <div className="operation-banner" style={{ display: "block" }}>
      <p>
        工作台锁由进程 {info.pid ?? "未知"} 持有。
        {info.dead ? "该进程已退出。" : "尚不能确认该进程已经退出。"}
      </p>
      {info.reason && <p>{info.reason}</p>}
      <button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
        重新检查锁
      </button>
      {info.indexLock?.exists && (
        <p>
          {info.indexLock.owned
            ? "同时发现本应用留下的索引锁，可一起核对释放。"
            : "索引锁归属未确认，将保留。"}
        </p>
      )}
      <button
        disabled={busy || !info.canRelease || !info.token}
        onClick={() => {
          const token = info.token;
          const target = repo;
          confirm(
            "释放失效工作台锁",
            `进程：${info.pid}\n创建时间：${info.createdAt || "未知"}\n将重新核对原进程确已退出且锁内容未变；只释放已确认属于原操作的锁，然后显示恢复记录。`,
            async () => {
              if (
                !active.current ||
                currentRepo.current !== target ||
                pending.current
              )
                return;
              pending.current = true;
              setBusy(true);
              try {
                await request("workspaceUnlock", target, {
                  expectedToken: token,
                  confirm: true,
                });
                if (active.current && currentRepo.current === target)
                  await refresh();
              } catch (e) {
                if (active.current && currentRepo.current === target)
                  setError((e as Error).message);
                throw e;
              } finally {
                pending.current = false;
                if (active.current) setBusy(false);
              }
            },
          );
        }}
      >
        释放已确认失效的锁…
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
