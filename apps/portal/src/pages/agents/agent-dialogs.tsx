// Small Agent Builder dialogs: copy an agent under a new name, and create or edit a
// shared skill (Agent Skills format: name, description, body).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { agentsApi, type SharedSkillView } from "@/lib/api/agents";

const errorText = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function CopyAgentDialog({ source, onClose, onCopied }: { source: string | null; onClose: () => void; onCopied: (name: string) => Promise<void> }): React.JSX.Element {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    if (busy) return;
    setName("");
    setError(null);
    onClose();
  };

  async function copy(): Promise<void> {
    if (source === null) return;
    setBusy(true);
    setError(null);
    try {
      const created = await agentsApi.copy(source, name.trim());
      setName("");
      onClose();
      await onCopied(created.name);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={source !== null}
      title="Copy agent"
      description={source === null ? undefined : `A custom copy of ${source} that you can edit. The original stays unchanged.`}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant="solid" disabled={busy || name.trim() === ""} onClick={() => void copy()}>
            {busy ? "Copying…" : "Copy"}
          </Button>
        </>
      }
    >
      <Field label="New name" hint="Lowercase letters, digits and hyphens. Built-in names are reserved.">
        <Input value={name} autoFocus placeholder={source === null ? "" : `my-${source}`} onChange={(event) => setName(event.target.value)} />
      </Field>
      {error === null ? null : <p role="alert" className="mt-3 text-[13px] text-[var(--ds-status-red)]">{error}</p>}
    </Modal>
  );
}

interface SharedSkillDialogProps {
  open: boolean;
  /** null: create. */
  skill: SharedSkillView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function SharedSkillDialog(props: SharedSkillDialogProps): React.JSX.Element | null {
  // Keyed so the form state starts fresh for every skill opened.
  if (!props.open) return null;
  return <SharedSkillForm key={props.skill?.name ?? "new"} {...props} />;
}

function SharedSkillForm({ open, skill, onClose, onSaved }: SharedSkillDialogProps): React.JSX.Element {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [content, setContent] = useState(skill?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const input = { name: name.trim(), description, content };
      if (skill === null) await agentsApi.createSkill(input);
      else await agentsApi.updateSkill(skill.name, input);
      await onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      size="wide"
      title={skill === null ? "New shared skill" : `Edit ${skill.name}`}
      description="Instructions loaded into every agent that lists this skill."
      onClose={() => (busy ? undefined : onClose())}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input value={name} disabled={skill !== null} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description" hint="When an agent should use this skill.">
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Instructions">
          <Textarea mono rows={12} value={content} onChange={(event) => setContent(event.target.value)} />
        </Field>
        {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
