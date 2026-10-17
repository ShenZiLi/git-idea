import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const PresenceContext = createContext(true);

function motionAllowed() {
  return (
    document.documentElement.dataset.input !== "keyboard" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Keep the outgoing surface mounted so a rapid reversal retargets its transition.
export function Presence({ children }: { children: ReactNode }) {
  const present = Boolean(children);
  const content = useRef(children);
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(present);
  const [open, setOpen] = useState(false);
  if (present) content.current = children;

  useLayoutEffect(() => {
    let frame = 0;
    let nextFrame = 0;
    let cancelled = false;
    if (present) {
      setMounted(true);
      if (motionAllowed())
        frame = requestAnimationFrame(() => {
          nextFrame = requestAnimationFrame(() => setOpen(true));
        });
      else setOpen(true);
    } else {
      setOpen(false);
      if (motionAllowed()) {
        frame = requestAnimationFrame(() => {
          const transitions =
            ref.current
              ?.getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation instanceof CSSTransition &&
                  animation.transitionProperty === "opacity" &&
                  (animation.effect as KeyframeEffect).target?.matches(
                    ".modal-backdrop,.popover,.toast",
                  ),
              ) || [];
          void Promise.allSettled(
            transitions.map((animation) => animation.finished),
          ).then(() => {
            if (!cancelled) setMounted(false);
          });
        });
      } else setMounted(false);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      cancelled = true;
    };
  }, [present]);

  if (!present && !mounted) return null;
  return (
    <PresenceContext.Provider value={present}>
      <div
        ref={ref}
        className="presence"
        data-state={open && present ? "open" : "closed"}
        inert={!present}
        aria-hidden={!present || undefined}
      >
        {content.current}
      </div>
    </PresenceContext.Provider>
  );
}

export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => (root.dataset.input = "pointer");
    const keyboard = () => (root.dataset.input = "keyboard");
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
}

export function useTheme(theme: string) {
  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.dataset.themeSwap = "";
    style.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.append(style);
    document.documentElement.dataset.theme = theme;
    void document.body.offsetHeight;
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => style.remove());
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      style.remove();
    };
  }, [theme]);
}

export function IconSwap({
  active,
  on,
  off,
}: {
  active: boolean;
  on: ReactNode;
  off: ReactNode;
}) {
  return (
    <span className="icon-swap" aria-hidden="true">
      <span data-visible={active}>{on}</span>
      <span data-visible={!active}>{off}</span>
    </span>
  );
}
