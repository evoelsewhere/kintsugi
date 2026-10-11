// ConfirmDialog — a small Modal for irreversible actions (remove, revoke, publish). Runs the
// action itself: the confirm button disables while it runs, and an error stays in the
// dialog instead of closing it.

import { useState } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Body text explaining the consequences. */
  children: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  /** `danger` (default) for destructive actions, `solid` for ones that create something. */
  confirmVariant?: "danger" | "solid";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, children, confirmLabel, busyLabel, confirmVariant = "danger", onConfirm, onClose }: ConfirmDialogProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    if (busy) return;
    setError(null);
    onClose();
  };

  async function confirm(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      {...(description === undefined ? {} : { description })}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant={confirmVariant} disabled={busy} onClick={() => void confirm()}>
            {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-5 text-text-muted">{children}</div>
      {error === null ? null : <p role="alert" className="mt-3 text-[13px] text-[var(--ds-status-red)]">{error}</p>}
    </Modal>
  );
}
