// MCP server form dialog (ADR-0047): an HTTP endpoint the runtime may give to agents. Header values
// are credentials: write-only, encrypted at rest, kept when left blank on an edit. The form mounts
// fresh each time the dialog opens, so its state always starts from the server being edited.

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { McpServerInput, McpServerView } from "@/lib/api/mcp-servers";
import { mcpHeaderValueProblem, MCP_SERVER_ID_PATTERN, mcpToolPrefix } from "@kintsugi/domain";

export interface McpServerFormDialogProps {
  open: boolean;
  server: McpServerView | null;
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, input: McpServerInput) => Promise<void>;
}

export function McpServerFormDialog(props: McpServerFormDialogProps): React.JSX.Element | null {
  return props.open ? <McpServerForm {...props} /> : null;
}

interface HeaderRow {
  name: string;
  value: string;
  stored: boolean;
}

function McpServerForm({ server, existingIds, onClose, onSubmit }: McpServerFormDialogProps): React.JSX.Element {
  const editing = server !== null;
  const [id, setId] = useState(server?.id ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [timeoutSec, setTimeoutSec] = useState(String(server?.timeoutSec ?? 60));
  const [allowed, setAllowed] = useState((server?.allowedTools ?? []).join(", "));
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [headers, setHeaders] = useState<HeaderRow[]>((server?.headerNames ?? []).map((name) => ({ name, value: "", stored: true })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(): Promise<void> {
    const serverId = id.trim();
    if (!editing && !MCP_SERVER_ID_PATTERN.test(serverId)) return setError("Id: lowercase letters, digits and dashes, starting with a letter (at most 41 characters).");
    if (!editing && existingIds.includes(serverId)) return setError(`A server named "${serverId}" already exists.`);
    if (!/^https?:\/\/\S+$/.test(url.trim())) return setError("Address must start with http:// or https://.");
    const timeout = Number(timeoutSec);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) return setError("Timeout: a whole number of seconds from 1 to 300.");
    const tools = allowed.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (tools.some((entry) => !/^[A-Za-z0-9_*]{1,100}$/.test(entry))) return setError("Allowed tools use letters, digits and underscores; * matches any characters.");
    const entries: Array<[string, string | null]> = [];
    const seen = new Set<string>();
    for (const row of headers) {
      const name = row.name.trim();
      if (name === "") continue;
      if (!/^[A-Za-z0-9-]{1,100}$/.test(name)) return setError(`Header name "${name}": letters, digits and dashes only.`);
      if (seen.has(name.toLowerCase())) return setError(`Header "${name}" is listed twice.`);
      seen.add(name.toLowerCase());
      if (row.value === "" && !row.stored) return setError(`Enter a value for header "${name}".`);
      const problem = row.value === "" ? undefined : mcpHeaderValueProblem(row.value);
      if (problem !== undefined) return setError(`Header "${name}": ${problem}.`);
      entries.push([name, row.value === "" ? null : row.value]);
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(serverId, { url: url.trim(), ...(description.trim() === "" ? {} : { description: description.trim() }), enabled, timeoutSec: timeout, allowedTools: tools, headers: Object.fromEntries(entries) });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  const prefix = MCP_SERVER_ID_PATTERN.test(id.trim()) ? mcpToolPrefix(id.trim()) : undefined;
  const update = (index: number, patch: Partial<HeaderRow>): void => setHeaders((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Modal
      open
      size="nested"
      title={editing ? `Configure ${server.id}` : "Add MCP server"}
      description="An HTTP MCP server the runtime may give to agents that name it in their tools. Only the tools the server marks read-only, or you allow by name, ever run."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save server"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Id" hint={prefix === undefined ? "Names the server in an agent's tools, e.g. mcp__tracker__*." : `Its tools are named ${prefix}<tool>; an agent names the server as ${prefix}*.`}>
          <Input value={id} disabled={editing} placeholder="tracker" aria-label="Id" onChange={(event) => setId(event.target.value)} />
        </Field>
        <Field label="Address" hint={editing ? "Changing the address requires entering the header values again." : "The server's Streamable HTTP endpoint."}>
          <Input value={url} placeholder="https://mcp.example.com/mcp" aria-label="Address" onChange={(event) => setUrl(event.target.value)} />
        </Field>
        <Field label="Description" hint="One sentence on what the server offers; the model reads it.">
          <Input value={description} placeholder="Issue tracker: search and read issues" aria-label="Description" onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[14px] leading-5 text-text">Headers</span>
            <Button size="small" variant="ghost" onClick={() => setHeaders((prev) => [...prev, { name: "", value: "", stored: false }])}>
              <Plus className="size-3.5" strokeWidth={2} /> Add header
            </Button>
          </div>
          <p className="text-[12px] text-text-muted">For example Authorization: Bearer … Values are write-only and encrypted at rest; leave a stored value blank to keep it.</p>
          {headers.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2">
              <Input value={row.name} placeholder="header name" aria-label={`Header ${index + 1} name`} onChange={(event) => update(index, { name: event.target.value })} />
              <Input
                type="password"
                autoComplete="new-password"
                value={row.value}
                placeholder={row.stored ? "Stored — leave blank to keep" : "value"}
                aria-label={`Header ${index + 1} value`}
                onChange={(event) => update(index, { value: event.target.value })}
              />
              <Button size="small" variant="ghost" aria-label={`Remove header ${index + 1}`} onClick={() => setHeaders((prev) => prev.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </Button>
            </div>
          ))}
        </div>

        <Field label="Also allow these tools" hint="Tools that do not mark themselves read-only run only when named here (comma separated; * matches any characters), e.g. create_issue, export_*. Leave empty to allow read-only tools only.">
          <Input value={allowed} placeholder="create_issue, export_*" aria-label="Allowed tools" onChange={(event) => setAllowed(event.target.value)} />
        </Field>
        <Field label="Request timeout (seconds)">
          <Input value={timeoutSec} inputMode="numeric" aria-label="Request timeout" onChange={(event) => setTimeoutSec(event.target.value)} />
        </Field>
        <Checkbox checked={enabled} onChange={setEnabled} label="Enabled: agents that name it can use it" />

        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
