// Header — DESIGN.md §9 Prompt 2: fixed 64px, background #FAFAFA, bottom edge as
// shadow (0 1px 0 0 rgba(0,0,0,0.1)), items 14px/400 #4D4D4D with gray hover fill.
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { StatusDot } from "../components/ui/status-dot";
import { useHealth } from "../lib/use-health";

const HEALTH_TONE = {
  checking: "orange",
  up: "green",
  down: "red",
} as const;

const HEALTH_LABEL = {
  checking: "API checking…",
  up: "API connected",
  down: "API unreachable",
} as const;

export function Header(): React.JSX.Element {
  const health = useHealth();

  return (
    <header
      className="sticky top-0 z-10 flex h-[var(--header-height)] items-center gap-8 bg-background px-6"
      style={{ boxShadow: "var(--header-border-bottom)" }}
    >
      <Link to="/" className="focus-ring rounded-[var(--geist-radius)] px-2 py-1 text-[14px] font-medium text-text">
        Kintsugi
      </Link>

      <span className="text-caption text-text-muted">Migration &amp; modernization portal</span>

      <div className="ml-auto flex items-center gap-3">
        <Badge>
          <StatusDot tone={HEALTH_TONE[health]} />
          {HEALTH_LABEL[health]}
        </Badge>
        <Badge>v0.0.0</Badge>
      </div>
    </header>
  );
}
