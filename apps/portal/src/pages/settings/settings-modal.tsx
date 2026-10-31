// Settings modal — opens from the sidebar user card or the Settings nav entry. A section with unsaved changes reports
// them (unsaved-changes.ts): closing the modal or switching section then asks before dropping them.

import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { SettingsTabs } from "./settings-tabs";
import { UnsavedChanges, type UnsavedChangesReporter } from "./unsaved-changes";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
}

export function SettingsModal({ open, onClose, initialTab }: SettingsModalProps): React.JSX.Element {
  const dirty = useRef(false);
  const reporter = useMemo<UnsavedChangesReporter>(() => ({ report: (value) => (dirty.current = value) }), []);
  /** What was asked while changes were unsaved: run once the person discards them. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (action: () => void): void => {
    if (dirty.current) setPending(() => action);
    else action();
  };
  const close = (): void => guard(onClose);

  return (
    <>
      <Modal open={open} size="page" title="Settings" description="Installation-level configuration, stored in the database." onClose={close}>
        <UnsavedChanges.Provider value={reporter}>
          <SettingsTabs initial={initialTab} onClose={close} guard={guard} />
        </UnsavedChanges.Provider>
      </Modal>
      <ConfirmDialog
        open={pending !== null}
        title="Discard unsaved changes?"
        description="This section has changes that are not saved."
        confirmLabel="Discard changes"
        onConfirm={async () => {
          dirty.current = false;
          pending?.();
        }}
        onClose={() => setPending(null)}
      >
        <p className="text-[13px] text-text-secondary">Cancel to keep editing and save them; discard to leave them unsaved.</p>
      </ConfirmDialog>
    </>
  );
}
