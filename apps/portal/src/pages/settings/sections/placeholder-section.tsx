// Reusable skeleton for a settings section that is not implemented yet.

import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { StatusDot } from "../../../components/ui/status-dot";

export interface PlaceholderSectionProps {
  title: string;
  description: string;
}

export function PlaceholderSection({ title, description }: PlaceholderSectionProps): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <StatusDot tone="muted" />
      </CardHeader>
      <CardContent>
        <Badge>not implemented yet</Badge>
      </CardContent>
    </Card>
  );
}
