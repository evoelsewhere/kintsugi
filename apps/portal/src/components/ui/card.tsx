// Card — DESIGN.md §5/§6: elevated surface, shadow-as-border (no CSS border),
// radius 12px, padding 24px. Depth composes border layer + subtle drop shadow.
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("shadow-border-medium rounded-xl bg-surface p-4", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h3 className={cn("h-subtitle text-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-caption mt-0.5 text-text-secondary", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("mt-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("mt-3 flex items-center gap-2", className)} {...props} />;
}
