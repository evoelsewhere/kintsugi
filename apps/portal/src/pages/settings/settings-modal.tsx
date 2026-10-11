// Settings modal — opens from the sidebar user card or the Settings nav entry.

import { Modal } from "@/components/ui/modal";
import { SettingsTabs } from "./settings-tabs";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
}

export function SettingsModal({ open, onClose, initialTab }: SettingsModalProps): React.JSX.Element {
  return (
    <Modal open={open} size="page" title="Settings" description="Installation-level configuration, stored in the database." onClose={onClose}>
      <SettingsTabs initial={initialTab} />
    </Modal>
  );
}
