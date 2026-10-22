// Main-branch dialog: the branch Kintsugi follows for a repository — what its mirror tracks, what runs analyse
// and where documents are written. The branches are listed from the server with its stored credential; saving
// sends the repository back to `pending` and the worker syncs it on the new branch.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { gitApi, type GitRepositoryView } from "@/lib/api/git";
import { useLoader } from "@/lib/use-loader";

export interface GitBranchDialogProps {
  /** The repository to change, or null while the dialog is closed. */
  repository: GitRepositoryView | null;
  onClose: () => void;
  onSubmit: (repository: GitRepositoryView, branch: string) => Promise<void>;
}

export function GitBranchDialog(props: GitBranchDialogProps): React.JSX.Element | null {
  return props.repository === null ? null : <GitBranchForm {...props} repository={props.repository} />;
}

function GitBranchForm({ repository, onClose, onSubmit }: GitBranchDialogProps & { repository: GitRepositoryView }): React.JSX.Element {
  const branches = useLoader(`git-branches/${repository.id}`, () => gitApi.repositoryBranches(repository.id));
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = branches.data?.current;
  const branch = picked ?? current ?? branches.data?.remoteDefault ?? "";

  async function submit(): Promise<void> {
    if (branch === "") return;
    setError(null);
    setSaving(true);
    try {
      await onSubmit(repository, branch);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="nested"
      title={`Main branch of ${repository.id}`}
      description="Kintsugi mirrors this branch, reads it for analysis and writes documents to it. The repository is synced again after the change."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" disabled={saving || branch === "" || branch === current} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save branch"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Branch" hint="Listed from the server with this repository's credential.">
          <Select
            value={branch}
            placeholder={branches.data === undefined ? "Loading branches…" : "No branches"}
            options={(branches.data?.branches ?? []).map((name) => ({
              value: name,
              label: name,
              ...(name === branches.data?.remoteDefault ? { hint: "server default" } : {}),
            }))}
            onChange={setPicked}
          />
        </Field>
        {branches.error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {branches.error}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
