// A Mermaid diagram from an agent-written .mmd file. Mermaid is loaded on first use (it is
// large) and runs with securityLevel "strict": no HTML labels, no click handlers, no scripts.
// Pan by dragging, zoom with the buttons or Ctrl + wheel; the source is one click away.
// `onNodeClick` reports clicks on flowchart nodes by their Mermaid id, read from the drawn SVG
// (no Mermaid click callbacks, which "strict" disables).

import { Code2, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MermaidApi = (typeof import("mermaid"))["default"];
let loading: Promise<MermaidApi> | undefined;
let theme: "neutral" | "dark" | undefined;
/** Mermaid renders one diagram at a time. */
let queue: Promise<unknown> = Promise.resolve();

async function render(id: string, source: string): Promise<string> {
  loading ??= import("mermaid").then((module) => module.default);
  const mermaid = await loading;
  const wanted = document.documentElement.classList.contains("dark") ? "dark" : "neutral";
  if (theme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: wanted, fontFamily: "inherit", flowchart: { htmlLabels: false }, maxTextSize: 200_000 });
    theme = wanted;
  }
  const next = queue.then(() => mermaid.render(id, source));
  queue = next.catch(() => undefined);
  return (await next).svg;
}

/** The Mermaid id of the flowchart node an element belongs to. */
function flowchartNodeId(target: EventTarget): string | undefined {
  const node = target instanceof Element ? target.closest("g.node") : null;
  if (node === null) return undefined;
  return node.getAttribute("data-id") ?? /flowchart-(.+)-\d+$/.exec(node.id)?.[1];
}

export interface MermaidDiagramProps {
  source: string;
  title: string;
  className?: string;
  height?: number;
  /** Called with the Mermaid id of a clicked flowchart node; nodes show a pointer when set. */
  onNodeClick?: (id: string) => void;
  /** Extra controls in the toolbar, before the zoom buttons. */
  toolbar?: React.ReactNode;
}

export function MermaidDiagram({ source, title, className, height = 560, onNodeClick, toolbar }: MermaidDiagramProps): React.JSX.Element {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; node: string | undefined } | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    render(id, source)
      .then((result) => {
        if (!cancelled) {
          setSvg(result);
          setError(null);
        }
      })
      .catch((failure: unknown) => {
        // A failed render leaves its error element behind.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  /** Fits the whole diagram in the view (never enlarges it). */
  const fit = (): void => {
    const natural = content.current?.scrollHeight ?? 0;
    setZoom(natural <= height ? 1 : Math.max(0.25, (height - 8) / natural));
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-1">
        <p className="mr-auto truncate text-[12px] text-text-muted">{title}</p>
        {toolbar}
        {showSource || error !== null ? null : (
          <>
            <Button size="icon" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}>
              <Minus />
            </Button>
            <span className="w-10 text-center text-[11px] text-text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(4, value * 1.25))}>
              <Plus />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Fit the whole diagram" title="Fit the whole diagram" onClick={fit}>
              <Maximize2 />
            </Button>
          </>
        )}
        <Button size="small" variant="ghost" aria-pressed={showSource} onClick={() => setShowSource((value) => !value)}>
          <Code2 />
          {showSource ? "Diagram" : "Source"}
        </Button>
      </div>
      {showSource || error !== null ? (
        <>
          {error === null ? null : <p className="text-[12px] text-[var(--ds-status-red)]">The diagram could not be drawn ({error.split("\n")[0]}); its source:</p>}
          <pre className="overflow-auto rounded-lg bg-recessed p-3 font-mono text-[12px] leading-5 text-text-secondary" style={{ maxHeight: height }}>
            {source}
          </pre>
        </>
      ) : (
        <div
          className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-recessed/60 select-none active:cursor-grabbing"
          style={{ height }}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            setZoom((value) => Math.min(4, Math.max(0.25, value * (event.deltaY < 0 ? 1.1 : 0.9))));
          }}
          onPointerDown={(event) => {
            drag.current = {
              x: event.clientX - offset.x,
              y: event.clientY - offset.y,
              startX: event.clientX,
              startY: event.clientY,
              node: onNodeClick === undefined ? undefined : flowchartNodeId(event.target),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current !== null) setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
          }}
          onPointerUp={(event) => {
            const started = drag.current;
            drag.current = null;
            // A click, not a drag: report the node it started on.
            if (started?.node !== undefined && Math.abs(event.clientX - started.startX) + Math.abs(event.clientY - started.startY) < 5) onNodeClick?.(started.node);
          }}
        >
          {svg === null ? (
            <p className="p-4 text-[12px] text-text-muted">Drawing the diagram…</p>
          ) : (
            <div
              ref={content}
              className={cn("flex w-full items-start justify-center p-4 [&_svg]:h-auto [&_svg]:max-w-full", onNodeClick === undefined ? undefined : "[&_g.node]:cursor-pointer")}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "top center" }}
              // Rendered by Mermaid with securityLevel "strict": sanitized SVG without HTML labels.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      )}
    </div>
  );
}
