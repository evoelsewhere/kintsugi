// Page header: display heading with negative tracking (DESIGN.md §3) and a
// secondary description. Sections are separated by spacing, never by divider lines.
import * as React from "react";

export interface PageHeaderProps {
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="h-title text-text">{title}</h1>
      <p className="max-w-[720px] text-[16px] text-text-secondary">{description}</p>
      {children}
    </header>
  );
}
