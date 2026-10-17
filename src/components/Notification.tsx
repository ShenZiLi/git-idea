import { useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { PresenceContext } from "./Motion";
import { IconButton } from "./ui";

export interface NotificationMessage {
  message: string;
  error: boolean;
}

export function Notification({
  notification,
  onDismiss,
  onConsole,
}: {
  notification: NotificationMessage;
  onDismiss: () => void;
  onConsole: () => void;
}) {
  const present = useContext(PresenceContext);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const clock = useRef({ notification, remaining: 6000 });
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (clock.current.notification !== notification) {
      clock.current = { notification, remaining: 6000 };
    }
    // Errors stay available until dismissed; success messages pause while being read.
    if (!present || notification.error || hovered || focused || hidden) return;
    const current = clock.current;
    const started = performance.now();
    const timer = setTimeout(() => dismiss.current(), current.remaining);
    return () => {
      clearTimeout(timer);
      current.remaining = Math.max(
        0,
        current.remaining - (performance.now() - started),
      );
    };
  }, [notification, present, hovered, focused, hidden]);
  return (
    <div
      className={`toast ${notification.error ? "error" : ""}`}
      role={notification.error ? "alert" : "status"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        {notification.error ? <AlertCircle size={17} /> : <Check size={17} />}
      </span>
      <div>
        <strong>{notification.error ? "操作未完成" : "操作成功"}</strong>
        <pre>{notification.message}</pre>
        {notification.error && (
          <button className="text-button" onClick={onConsole}>
            查看控制台
          </button>
        )}
      </div>
      <IconButton title="关闭通知" onClick={onDismiss}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
