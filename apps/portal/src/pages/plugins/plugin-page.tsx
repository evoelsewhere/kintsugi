// Plugin page (Administration → Plugins → /plugins/:name, ADR-0035): what the plugin carries,
// grouped by kind (Overview), and its folder as a file tree beside a read-only code view (Files).

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FileBrowser } from "@/components/file-browser";
import { Loaded } from "@/components/loaded";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { COMPONENT_KINDS, type PluginDetail, pluginsApi } from "@/lib/api/plugins";
import { CommandBoard, PipelineBoard, WorkflowLegend } from "./workflow-board";
import { useLoader } from "@/lib/use-loader";

type Tab = "overview" | "files";

const MANIFEST = ".claude-plugin/plugin.json";

export function PluginPage(): React.JSX.Element {
  const { name = "" } = useParams();
  const plugin = useLoader(`plugin:${name}`, () => pluginsApi.get(name));
  return (
    <div className="flex flex-col gap-5">
      {plugin.data === undefined ? <PageHeader crumbs={["Administration", { label: "Plugins", to: "/plugins" }, name]} /> : null}
      <Loaded loader={plugin}>{(data) => <PluginView key={data.name} plugin={data} />}</Loaded>
    </div>
  );
}

function PluginView({ plugin }: { plugin: PluginDetail }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "files" ? "files" : "overview";
  const selected = params.get("file") ?? MANIFEST;
  const open = (next: Tab, file?: string): void => {
    const query = new URLSearchParams({ tab: next });
    if (file !== undefined) query.set("file", file);
    setParams(query, { replace: false });
  };
  return (
    <>
      <PageHeader
        crumbs={["Administration", { label: "Plugins", to: "/plugins" }, plugin.title]}
        title={plugin.title}
        description={plugin.description}
        actions={
          <>
            <Badge>Built-in · read-only</Badge>
            <span className="font-mono text-[12px] text-text-muted">{plugin.name}@{plugin.version}</span>
            <Link to="/plugins" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text">
              <ArrowLeft className="size-4" />
              Plugins
            </Link>
          </>
        }
      />
      <Tabs
        label="Plugin"
        value={tab}
        onChange={(next) => open(next)}
        tabs={[
          { id: "overview", label: "Overview", count: plugin.components.length },
          { id: "files", label: "Files", count: plugin.files.length },
        ]}
      />
      {tab === "overview" ? <Overview plugin={plugin} onOpenFile={(file) => open("files", file)} /> : <Files plugin={plugin} selected={selected} onSelect={(file) => open("files", file)} />}
    </>
  );
}

/** The plugin's agentic workflow: its commands as a pipeline, one command end to end, then the parts it is made of. */
function Overview({ plugin, onOpenFile }: { plugin: PluginDetail; onOpenFile: (path: string) => void }): React.JSX.Element {
  const [command, setCommand] = useState(plugin.flows[0]?.command ?? "");
  const flow = plugin.flows.find((entry) => entry.command === command);
  return (
    <div className="flex flex-col gap-6">
      {plugin.flows.length === 0 ? null : (
        <section aria-label="How the plugin works" className="flex flex-col gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-text">How it works</h2>
            <p className="text-[12px] text-text-muted">The commands in order, linked where one writes what the next reads. Pick a command to see it end to end; click a box to open its file.</p>
          </div>
          <PipelineBoard flows={plugin.flows} pipeline={plugin.pipeline} selected={command} onSelect={setCommand} />
          {flow === undefined ? null : (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-text-secondary">
                <span className="font-mono text-text">/{flow.command}</span> — {flow.description}
              </p>
              <CommandBoard flow={flow} onOpenFile={onOpenFile} />
              <WorkflowLegend />
            </div>
          )}
        </section>
      )}
      <h2 className="-mb-3 text-[14px] font-medium text-text">Components</h2>
      {COMPONENT_KINDS.map(({ kind, plural }) => {
        const items = plugin.components.filter((component) => component.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={plural}>
            <h2 className="mb-1.5 text-[13px] font-medium text-text">
              {plural} <span className="font-normal text-text-muted">{items.length}</span>
            </h2>
            <ul className="overflow-hidden rounded-[var(--geist-radius)] shadow-border">
              {items.map((component) => (
                <li key={component.path} className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] first:shadow-none">
                  <button type="button" onClick={() => onOpenFile(component.path)} className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                    <span className="w-48 shrink-0 truncate font-mono text-[13px] text-text">{component.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary" title={component.description}>
                      {component.description}
                    </span>
                    {component.audience === undefined ? null : <span className="shrink-0 text-[12px] text-text-muted">{component.audience}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Files({ plugin, selected, onSelect }: { plugin: PluginDetail; selected: string; onSelect: (path: string) => void }): React.JSX.Element {
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const known = plugin.files.some((file) => file.path === selected);
  const path = known ? selected : MANIFEST;

  useEffect(() => {
    if (texts.has(path)) return;
    let cancelled = false;
    pluginsApi
      .file(plugin.name, path)
      .then((file) => {
        if (!cancelled) setTexts((current) => new Map(current).set(path, file.content));
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError({ path, message: failure instanceof Error ? failure.message : String(failure) });
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.name, path, texts]);

  return <FileBrowser title={plugin.name} paths={plugin.files.map((file) => file.path)} selected={path} onSelect={onSelect} text={texts.get(path)} error={error?.path === path ? error.message : null} />;
}
