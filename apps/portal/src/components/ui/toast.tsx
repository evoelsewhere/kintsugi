// Toasts — the one feedback pattern for actions: a short success or error message in the
// bottom-right corner, announced to screen readers. Successes close after a few seconds,
// errors stay longer and can be dismissed. Inline errors stay for form validation; every
// saved, queued or failed action also reports here, so feedback looks the same everywhere.

import { CircleAlert, CircleCheck, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorText } from "@/lib/format";

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastApi {
  success: (title: string, description?: string) => void;
  /** Accepts a message or a caught failure. */
  error: (title: string, failure?: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION: Record<ToastTone, number> = { success: 4000, error: 9000 };

// The provider and its hook belong together; fast refresh reloads this module fully.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToast must be used inside ToastProvider");
  return api;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = ++next.current;
      setItems((current) => [...current.slice(-3), { id, tone, title, ...(description === undefined || description === "" ? {} : { description }) }]);
      setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      error: (title, failure) => push("error", title, failure === undefined ? undefined : typeof failure === "string" ? failure : errorText(failure)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-surface px-3.5 py-3"
              style={{ boxShadow: "var(--ds-shadow-menu)" }}
            >
              {item.tone === "success" ? (
                <CircleCheck className="mt-px size-4 shrink-0 text-[var(--ds-status-green)]" strokeWidth={2} />
              ) : (
                <CircleAlert className="mt-px size-4 shrink-0 text-[var(--ds-status-red)]" strokeWidth={2} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">{item.title}</p>
                {item.description === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-text-secondary">{item.description}</p>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)} className="shrink-0 rounded-[var(--geist-radius)] text-text-muted hover:text-text">
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
