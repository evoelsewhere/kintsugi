// A Mermaid diagram from an agent-written .mmd file. Mermaid is loaded on first use (it is
// large) and runs with securityLevel "strict": no HTML labels, no click handlers, no scripts.
// Flowcharts, state and class diagrams are laid out by ELK (@mermaid-js/layout-elk), as GitHub draws them: it keeps the
// boxes of a nested subgraph together and routes edges between groups, where the default layout (dagre) stretches the
// diagram and draws long curves across it. A diagram ELK cannot lay out is drawn again with the default layout.
// Pan by dragging, zoom with the buttons or Ctrl + wheel; the source is one click away. The diagram is drawn at its own
// size and starts as large as the box width allows without going below `MIN_START_ZOOM`, so a wide diagram stays legible
// and is panned or fitted instead of shrunk to unreadable text. The box is as tall as the drawn diagram, up to `height`.
// `onNodeClick` reports clicks on flowchart nodes by their Mermaid id, read from the drawn SVG
// (no Mermaid click callbacks, which "strict" disables).

import { Code2, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MermaidApi = (typeof import("mermaid"))["default"];
type Layout = "elk" | "dagre";
let loading: Promise<MermaidApi> | undefined;
let configured: string | undefined;
/** Mermaid renders one diagram at a time. */
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<MermaidApi> {
  const [mermaid, elk] = await Promise.all([import("mermaid"), import("@mermaid-js/layout-elk")]);
  mermaid.default.registerLayoutLoaders(elk.default);
  return mermaid.default;
}

/** Applies the theme and the layout when either changed since the last render. */
function configure(mermaid: MermaidApi, layout: Layout): void {
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "neutral";
  if (configured === `${theme}/${layout}`) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    fontFamily: "inherit",
    layout,
    flowchart: { htmlLabels: false },
    elk: { mergeEdges: false, nodePlacementStrategy: "BRANDES_KOEPF" },
    maxTextSize: 200_000,
  });
  configured = `${theme}/${layout}`;
}

async function render(id: string, source: string): Promise<string> {
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  const mermaid = await loading;
  const next = queue.then(async () => {
    configure(mermaid, "elk");
    try {
      return await mermaid.render(id, source);
    } catch (failure) {
      // ELK could not lay it out (or the source is wrong): the default layout tells which.
      document.getElementById(`d${id}`)?.remove();
      configure(mermaid, "dagre");
      return mermaid.render(id, source).catch(() => {
        throw failure;
      });
    }
  });
  queue = next.catch(() => undefined);
  return (await next).svg;
}

/** The Mermaid id of the flowchart node an element belongs to. */
function flowchartNodeId(target: EventTarget): string | undefined {
  const node = target instanceof Element ? target.closest("g.node") : null;
  if (node === null) return undefined;
  return node.getAttribute("data-id") ?? /flowchart-(.+)-\d+$/.exec(node.id)?.[1];
}

/** Whether the portal is in the dark theme; follows the class on <html> so diagrams redraw on a switch. */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** The smallest box, so a one-node diagram still has room to drag. */
const MIN_HEIGHT = 96;
/** A wide diagram starts no smaller than this, whatever the box width. */
const MIN_START_ZOOM = 0.6;
/** The box while the diagram is drawn. */
const DRAWING_HEIGHT = 160;

export interface MermaidDiagramProps {
  source: string;
  title: string;
  className?: string;
  /** The tallest the box gets; a smaller diagram gets a box its own height. */
  height?: number;
  /** Called with the Mermaid id of a clicked flowchart node; nodes show a pointer when set. */
  onNodeClick?: (id: string) => void;
  /** Extra controls in the toolbar, before the zoom buttons. */
  toolbar?: React.ReactNode;
}

export function MermaidDiagram({ source, title, className, height = 560, onNodeClick, toolbar }: MermaidDiagramProps): React.JSX.Element {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dark = useDarkTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; node: string | undefined } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const placed = useRef<string | null>(null);
  // The drawn diagram's own size (unscaled: a transform does not change layout size).
  const [natural, setNatural] = useState<{ width: number; height: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;
    // Mermaid sizes the SVG to its container; draw it at the size its own layout gave it.
    const drawn = element.querySelector("svg");
    const box = drawn?.viewBox.baseVal;
    if (drawn !== null && box !== undefined && box.width > 0) {
      drawn.style.maxWidth = "none";
      drawn.style.width = `${box.width}px`;
      drawn.style.height = `${box.height}px`;
    }
    const measure = (): void => setNatural({ width: element.scrollWidth, height: element.scrollHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [svg]);

  /** The zoom and the offset that put a diagram of the given size in the frame: centered when narrower, from the left when wider. */
  const place = (size: { width: number; height: number }, zoomed: number): void => {
    const width = frame.current?.clientWidth ?? size.width;
    setZoom(zoomed);
    setOffset({ x: Math.max(0, (width - size.width * zoomed) / 2), y: 0 });
  };

  // A new drawing starts as large as the frame allows, not below MIN_START_ZOOM.
  useLayoutEffect(() => {
    if (svg === null || natural === undefined || placed.current === svg) return;
    placed.current = svg;
    const width = frame.current?.clientWidth ?? natural.width;
    place(natural, Math.min(1, Math.max(MIN_START_ZOOM, width / natural.width)));
  }, [svg, natural]);

  const boxHeight = svg === null || natural === undefined ? Math.min(height, DRAWING_HEIGHT) : Math.min(height, Math.max(MIN_HEIGHT, natural.height * zoom));

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
  }, [id, source, dark]);

  /** Fits the whole diagram in the view (never enlarges it). */
  const fit = (): void => {
    if (natural === undefined) return;
    const width = frame.current?.clientWidth ?? natural.width;
    place(natural, Math.max(0.1, Math.min(1, (width - 8) / natural.width, (height - 8) / natural.height)));
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
          ref={frame}
          className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-recessed/60 select-none active:cursor-grabbing"
          style={{ height: boxHeight }}
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
              className={cn("w-max p-4", onNodeClick === undefined ? undefined : "[&_g.node]:cursor-pointer")}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "top left" }}
              // Rendered by Mermaid with securityLevel "strict": sanitized SVG without HTML labels.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      )}
    </div>
  );
}
