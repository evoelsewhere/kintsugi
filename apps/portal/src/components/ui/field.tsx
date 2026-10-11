// Field — consistent form field wrapper: label (14px/400) + optional hint.

import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, htmlFor, className, children }: FieldProps): React.JSX.Element {
  return (
    <label className={cn("flex flex-col gap-1.5", className)} htmlFor={htmlFor}>
      <span className="text-[14px] leading-5 text-text">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-[12px] leading-4 text-text-muted">{hint}</span>}
    </label>
  );
}
