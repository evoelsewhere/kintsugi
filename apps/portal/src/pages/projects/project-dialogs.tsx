// Project dialogs (ADR-0028): create/edit a project with its document repo, add/edit an
// application, and link a registered repository to an application as legacy, legacy-data
// or target (with its component). Repositories come from Settings -> Git.

import { DISPOSITIONS, type ApplicationRepositoryRole, type Disposition } from "@kintsugi/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GitRepositoryView } from "@/lib/api/git";
import type { ApplicationInput, ApplicationView, LinkInput, ProjectInput, ProjectView } from "@/lib/api/projects";

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** "Billing web" → "billing-web". */
function idFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const repositoryOptions = (repositories: GitRepositoryView[]): SelectOption[] =>
  repositories.map((repository) => ({ value: repository.id, label: repository.id, hint: repository.url }));

function FormError({ error }: { error: string | null }): React.JSX.Element | null {
  return error === null ? null : (
    <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
      {error}
    </p>
  );
}

function Footer({ saving, label, onClose, onSubmit }: { saving: boolean; label: string; onClose: () => void; onSubmit: () => void }): React.JSX.Element {
  return (
    <>
      <Button size="small" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button size="small" variant="solid" disabled={saving} onClick={onSubmit}>
        {saving ? "Saving…" : label}
      </Button>
    </>
  );
}

/** Runs a dialog submit: busy flag, error kept in the dialog, close on success. */
function useSubmit(onClose: () => void): { saving: boolean; error: string | null; setError: (error: string | null) => void; run: (work: () => Promise<void>) => Promise<void> } {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    saving,
    error,
    setError,
    run: async (work) => {
      setError(null);
      setSaving(true);
      try {
        await work();
        onClose();
      } catch (failure) {
        setError(message(failure));
      } finally {
        setSaving(false);
      }
    },
  };
}

// ---- project ----

export interface ProjectDialogProps {
  open: boolean;
  /** null creates a project. */
  project: ProjectView | null;
  repositories: GitRepositoryView[];
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, input: ProjectInput) => Promise<void>;
}

export function ProjectDialog(props: ProjectDialogProps): React.JSX.Element | null {
  return props.open ? <ProjectForm {...props} /> : null;
}

function ProjectForm({ project, repositories, existingIds, onClose, onSubmit }: ProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? "");
  const [id, setId] = useState(project?.id ?? "");
  const [idEdited, setIdEdited] = useState(project !== null);
  const [description, setDescription] = useState(project?.description ?? "");
  const [documentRepositoryId, setDocumentRepositoryId] = useState(project?.documentRepositoryId ?? "");
  const { saving, error, setError, run } = useSubmit(onClose);
  const effectiveId = idEdited ? id : idFromName(name);

  function submit(): void {
    if (name.trim() === "") return setError("Enter a name.");
    if (!ID.test(effectiveId)) return setError("Id: lowercase letters, digits and dashes.");
    if (project === null && existingIds.includes(effectiveId)) return setError(`A project "${effectiveId}" already exists.`);
    if (documentRepositoryId === "") return setError("Pick the document repository.");
    void run(() =>
      onSubmit(effectiveId, { name: name.trim(), description: description.trim() === "" ? (project === null ? undefined : null) : description.trim(), documentRepositoryId }),
    );
  }

  return (
    <Modal
      open
      title={project === null ? "New project" : "Edit project"}
      description="A project has one document repo: the repository that holds everything except code (ADR-0028)."
      onClose={onClose}
      footer={<Footer saving={saving} label={project === null ? "Create project" : "Save"} onClose={onClose} onSubmit={submit} />}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={name} placeholder="Billing modernization" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Id" hint={project === null ? "Derived from the name; stable once created." : "The id cannot change."}>
          <Input
            value={effectiveId}
            disabled={project !== null}
            placeholder="billing-modernization"
            onChange={(event) => {
              setIdEdited(true);
              setId(event.target.value.trim());
            }}
          />
        </Field>
        <Field label="Description">
          <Textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Document repository" hint="kintsugi.yaml, assessment, knowledge, units, standards and plugins live here.">
          <Select value={documentRepositoryId} placeholder="Pick a registered repository" options={repositoryOptions(repositories)} onChange={setDocumentRepositoryId} />
        </Field>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// ---- application ----

const DISPOSITION_OPTIONS: SelectOption[] = DISPOSITIONS.map((disposition) => ({ value: disposition, label: disposition }));

export interface ApplicationDialogProps {
  open: boolean;
  /** null adds an application. */
  application: ApplicationView | null;
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, input: ApplicationInput) => Promise<void>;
}

export function ApplicationDialog(props: ApplicationDialogProps): React.JSX.Element | null {
  return props.open ? <ApplicationForm {...props} /> : null;
}

function ApplicationForm({ application, existingIds, onClose, onSubmit }: ApplicationDialogProps): React.JSX.Element {
  const [name, setName] = useState(application?.name ?? "");
  const [id, setId] = useState(application?.id ?? "");
  const [idEdited, setIdEdited] = useState(application !== null);
  const [disposition, setDisposition] = useState<Disposition>(application?.disposition ?? "refactor");
  const [pipeline, setPipeline] = useState(application?.pipeline ?? "");
  const { saving, error, setError, run } = useSubmit(onClose);
  const effectiveId = idEdited ? id : idFromName(name);

  function submit(): void {
    if (name.trim() === "") return setError("Enter a name.");
    if (!ID.test(effectiveId)) return setError("Id: lowercase letters, digits and dashes.");
    if (application === null && existingIds.includes(effectiveId)) return setError(`An application "${effectiveId}" already exists.`);
    const trimmed = pipeline.trim();
    if (trimmed !== "" && !ID.test(trimmed)) return setError("Pipeline: lowercase letters, digits and dashes.");
    void run(() => onSubmit(effectiveId, { name: name.trim(), disposition, pipeline: trimmed === "" ? (application === null ? undefined : null) : trimmed }));
  }

  return (
    <Modal
      open
      title={application === null ? "Add application" : "Edit application"}
      description="An application in scope, with its 7R strategy and the pipeline it follows."
      onClose={onClose}
      footer={<Footer saving={saving} label={application === null ? "Add application" : "Save"} onClose={onClose} onSubmit={submit} />}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={name} placeholder="Billing web" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Id" hint={application === null ? "Derived from the name; used in unit ids and paths." : "The id cannot change."}>
          <Input
            value={effectiveId}
            disabled={application !== null}
            placeholder="billing-web"
            onChange={(event) => {
              setIdEdited(true);
              setId(event.target.value.trim());
            }}
          />
        </Field>
        <Field label="Disposition (7R)">
          <Select value={disposition} options={DISPOSITION_OPTIONS} onChange={(value) => setDisposition(value as Disposition)} />
        </Field>
        <Field label="Pipeline" hint="A built-in pipeline id (e.g. refactor), or a pipeline declared in kintsugi.yaml. Optional.">
          <Input value={pipeline} placeholder="refactor" onChange={(event) => setPipeline(event.target.value)} />
        </Field>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// ---- repository link ----

const ROLE_LABEL: Record<ApplicationRepositoryRole, string> = {
  legacy: "legacy code",
  "legacy-data": "legacy data",
  target: "target",
};

export interface LinkDialogProps {
  open: boolean;
  role: ApplicationRepositoryRole;
  applicationName: string;
  /** Registered repositories not linked to this project yet. */
  repositories: GitRepositoryView[];
  onClose: () => void;
  onSubmit: (input: LinkInput) => Promise<void>;
}

export function LinkDialog(props: LinkDialogProps): React.JSX.Element | null {
  return props.open ? <LinkForm {...props} /> : null;
}

function LinkForm({ role, applicationName, repositories, onClose, onSubmit }: LinkDialogProps): React.JSX.Element {
  const [repositoryId, setRepositoryId] = useState("");
  const [component, setComponent] = useState("");
  const { saving, error, setError, run } = useSubmit(onClose);

  function submit(): void {
    if (repositoryId === "") return setError("Pick a repository.");
    if (role === "target" && component.trim() === "") return setError("Name the architecture component this repository implements.");
    void run(() => onSubmit({ repositoryId, role, ...(role === "target" ? { component: component.trim() } : {}) }));
  }

  return (
    <Modal
      open
      title={`Link ${ROLE_LABEL[role]} repository`}
      description={
        role === "target"
          ? `TO-BE repository of ${applicationName}: only members write to it; the runtime never does.`
          : `AS-IS repository of ${applicationName}: read-only for Kintsugi.`
      }
      onClose={onClose}
      footer={<Footer saving={saving} label="Link repository" onClose={onClose} onSubmit={submit} />}
    >
      <div className="flex flex-col gap-4">
        <Field label="Repository">
          <Select value={repositoryId} placeholder={repositories.length === 0 ? "No unlinked repositories" : "Pick a repository"} options={repositoryOptions(repositories)} onChange={setRepositoryId} />
        </Field>
        {role === "target" ? (
          <Field label="Component" hint="Name of the TO-BE architecture component, e.g. web or api. One target repository per component.">
            <Input value={component} placeholder="api" onChange={(event) => setComponent(event.target.value)} />
          </Field>
        ) : null}
        <FormError error={error} />
      </div>
    </Modal>
  );
}
