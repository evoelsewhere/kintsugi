// Area card: a functional area from the building block view (A1–A7, B1–B7, …).
// Neutral placeholder state; the status dot carries the only chromatic signal.
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { StatusDot, type StatusTone } from "./ui/status-dot";

export interface AreaCardProps {
  title: string;
  description: string;
  status: string;
  tone: StatusTone;
}

export function AreaCard({ title, description, status, tone }: AreaCardProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <StatusDot tone={tone} />
      </CardHeader>
      <CardContent>
        <Badge>{status}</Badge>
      </CardContent>
    </Card>
  );
}
