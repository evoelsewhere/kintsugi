// "Apply to a project" (Settings → Providers → Agent model bindings): one provider, model and
// thinking level for every runtime agent of a project, saved at once as one project-scoped
// binding per agent (POST /api/admin/llm-providers/model-bindings/apply). The installation
// defaults and the other projects' bindings are kept.

import type { ThinkingLevel } from "@kintsugi/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ProjectView } from "@/lib/api/projects";
import { type ModelBindingStatus, providersApi, type ProviderView, type SupportedProviders } from "@/lib/api/providers";
import { errorText } from "@/lib/format";
import { modelOptions, modelThinkingLevels, thinkingOptions } from "@/lib/model-options";

export interface ApplyModelDialogProps {
  providers: ProviderView[];
  supported: SupportedProviders | undefined;
  projects: ProjectView[];
  /** How many runtime agents get a binding. */
  agentCount: number;
  onClose: () => void;
  onApplied: (bindings: ModelBindingStatus[], projectName: string) => void;
}

export function ApplyModelDialog({ providers, supported, projects, agentCount, onClose, onApplied }: ApplyModelDialogProps): React.JSX.Element {
  const [projectId, setProjectId] = useState("");
  const [providerId, setProviderId] = useState(providers.length === 1 ? (providers[0]?.id ?? "") : "");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((entry) => entry.id === providerId);
  const levels = modelThinkingLevels(provider, supported, model);
  const project = projects.find((entry) => entry.id === projectId);

  async function apply(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await providersApi.applyToProject({ projectId, provider: providerId, model, ...(thinking === "" ? {} : { thinking: thinking as ThinkingLevel }) });
      onApplied(saved, project?.name ?? projectId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="nested"
      title="Apply a model to a project"
      description={`Every runtime agent (${agentCount}) gets a binding for the project with this provider and model, in one save. The installation defaults and the other projects' bindings stay as they are.`}
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" disabled={saving || projectId === "" || providerId === "" || model === "" || agentCount === 0} onClick={() => void apply()}>
            {saving ? "Applying…" : `Apply to ${agentCount} agent${agentCount === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project">
          <Combobox value={projectId} placeholder="Choose project" options={projects.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.id }))} onChange={setProjectId} />
        </Field>
        <Field label="Provider">
          <Select
            value={providerId}
            placeholder="Choose provider"
            options={providers.map((entry) => ({ value: entry.id, label: entry.id, hint: entry.enabled ? entry.kind : "disabled" }))}
            onChange={(value) => {
              setProviderId(value);
              setModel("");
              setThinking("");
            }}
          />
        </Field>
        <Field label="Model">
          <Combobox
            value={model}
            placeholder="Choose model"
            disabled={providerId === ""}
            options={modelOptions(provider, supported, model)}
            onChange={(value) => {
              setModel(value);
              if (thinking !== "" && !modelThinkingLevels(provider, supported, value).includes(thinking as ThinkingLevel)) setThinking("");
            }}
          />
        </Field>
        <Field label="Thinking">
          <Select value={thinking} options={thinkingOptions(levels, thinking)} onChange={setThinking} />
        </Field>
        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
