// Project dialogs (ADR-0028): create/edit a project with its document repo, add/edit an
// application, and link a registered repository to an application as legacy, legacy-data
// or target (with its component). Repositories come from Settings -> Git: the project dialog
// reads them when it opens and after Settings closes, offers to register one, and shows the
// repositories another project uses as in use.

import type { ApplicationRepositoryRole } from "@kintsugi/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { gitApi, type GitRepositoryView } from "@/lib/api/git";
import { uniqueId } from "@/lib/ids";
import { type ApplicationInput, type ApplicationView, type LinkInput, type ProjectInput, projectsApi, type ProjectView, type RepositoryLinkView } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { documentRepositoryOptions } from "@/lib/repository-options";
import { useShell } from "@/lib/shell";
import { useLoader } from "@/lib/use-loader";

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
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, input: ProjectInput) => Promise<void>;
}

export function ProjectDialog(props: ProjectDialogProps): React.JSX.Element | null {
  return props.open ? <ProjectForm {...props} /> : null;
}

/** The registered repositories and where they are linked, read when the dialog opens and again after Settings → Git closes. */
async function loadRepositoryChoices(): Promise<{ repositories: GitRepositoryView[]; links: RepositoryLinkView[] }> {
  const [repositories, links] = await Promise.all([gitApi.listRepositories(), projectsApi.repositoryLinks()]);
  return { repositories, links };
}

function ProjectForm({ project, existingIds, onClose, onSubmit }: ProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [documentRepositoryId, setDocumentRepositoryId] = useState(project?.documentRepositoryId ?? "");
  const { saving, error, setError, run } = useSubmit(onClose);
  const { can } = useAuth();
  const { openSettings } = useShell();
  const choices = useLoader("project-dialog/repositories", loadRepositoryChoices, { live: ["repositories"] });
  const options = choices.data === undefined ? [] : documentRepositoryOptions(choices.data.repositories, choices.data.links, project?.id ?? null);
  const available = options.filter((option) => option.disabled !== true).length;

  function submit(): void {
    if (name.trim() === "") return setError("Enter a name.");
    const effectiveId = project?.id ?? uniqueId(name, existingIds);
    if (effectiveId === "") return setError("The name needs at least one letter or digit.");
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
        <Field label="Description">
          <Textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Document repository" hint="kintsugi.yaml, assessment, knowledge, units, standards and plugins live here. A repository another project uses cannot be chosen.">
          <Select
            value={documentRepositoryId}
            placeholder={choices.data === undefined ? "Loading repositories…" : available === 0 ? "No repository is free: register one" : "Pick a registered repository"}
            options={options}
            onChange={setDocumentRepositoryId}
          />
        </Field>
        <div className="-mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted">
          {choices.error === null ? null : <span className="text-[var(--ds-status-red)]">{choices.error}</span>}
          <span>Not in the list?</span>
          {can("git.manage") ? (
            <Button size="small" variant="link" className="h-auto px-0 text-[12px]" onClick={() => openSettings("git", () => void choices.reload())}>
              Register a repository in Settings → Git
            </Button>
          ) : (
            <span>Ask an administrator to register it in Settings → Git.</span>
          )}
        </div>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// ---- application ----

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
  const { saving, error, setError, run } = useSubmit(onClose);

  function submit(): void {
    if (name.trim() === "") return setError("Enter a name.");
    const effectiveId = application?.id ?? uniqueId(name, existingIds);
    if (effectiveId === "") return setError("The name needs at least one letter or digit.");
    void run(() => onSubmit(effectiveId, { name: name.trim() }));
  }

  return (
    <Modal
      open
      title={application === null ? "Add application" : "Edit application"}
      description="An application in scope: it is rebuilt from its legacy code."
      onClose={onClose}
      footer={<Footer saving={saving} label={application === null ? "Add application" : "Save"} onClose={onClose} onSubmit={submit} />}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={name} placeholder="Billing web" onChange={(event) => setName(event.target.value)} />
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
