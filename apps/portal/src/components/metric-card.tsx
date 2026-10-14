// Metric card — DESIGN.md §9 Prompt 1: surface #FFFFFF, shadow-as-border, radius 12px,
// title 14px/500, value 32px/600 with -1.28px tracking, subtitle 12px/400 #4D4D4D,
// status indicator as a 10px dot. With `to`, the whole card links to the detail.
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { StatusDot, type StatusTone } from "./ui/status-dot";

export interface MetricCardProps {
  title: string;
  /** Undefined while loading: a skeleton stands in. */
  value: string | undefined;
  subtitle: string;
  tone: StatusTone;
  to?: string;
}

export function MetricCard({ title, value, subtitle, tone, to }: MetricCardProps): React.JSX.Element {
  const card = (
    <Card className={to === undefined ? undefined : "h-full hover:bg-hover"}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <StatusDot tone={tone} />
      </CardHeader>
      <CardContent>
        {value === undefined ? <Skeleton className="h-8 w-16" /> : <p className="h-title text-text">{value}</p>}
        <p className="text-caption mt-1 text-text-secondary">{subtitle}</p>
      </CardContent>
    </Card>
  );
  return to === undefined ? (
    card
  ) : (
    <Link to={to} className="block rounded-xl focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
      {card}
    </Link>
  );
}
