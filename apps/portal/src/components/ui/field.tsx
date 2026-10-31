// Field — consistent form field wrapper: label (14px/400) + optional hint, or the field's error in its place.

import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: string;
  hint?: string;
  /** What is wrong with the value; shown instead of the hint. */
  error?: string | undefined;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, htmlFor, className, children }: FieldProps): React.JSX.Element {
  return (
    <label className={cn("flex flex-col gap-1.5", className)} htmlFor={htmlFor}>
      <span className="text-[14px] leading-5 text-text">{label}</span>
      {children}
      {error !== undefined ? (
        <span role="alert" className="text-[12px] leading-4 text-[var(--ds-status-red)]">{error}</span>
      ) : hint === undefined ? null : (
        <span className="text-[12px] leading-4 text-text-muted">{hint}</span>
      )}
    </label>
  );
}
