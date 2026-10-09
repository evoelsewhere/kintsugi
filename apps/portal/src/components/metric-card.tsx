// Metric card — DESIGN.md §9 Prompt 1: surface #FFFFFF, shadow-as-border, radius 12px,
// title 14px/500, value 32px/600 with -1.28px tracking, subtitle 12px/400 #4D4D4D,
// status indicator as a 10px dot.
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { StatusDot, type StatusTone } from "./ui/status-dot";

export interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  tone: StatusTone;
}

export function MetricCard({ title, value, subtitle, tone }: MetricCardProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <StatusDot tone={tone} />
      </CardHeader>
      <CardContent>
        <p className="h-title text-text">{value}</p>
        <p className="text-caption mt-1 text-text-secondary">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
