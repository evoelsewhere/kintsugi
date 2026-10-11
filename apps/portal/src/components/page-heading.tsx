// Page heading — the title row under the breadcrumbs: a title, one line of purpose and the
// page-level actions (selectors, refresh, primary action) on the right.

export function PageHeading({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight text-text">{title}</h1>
        {description === undefined ? null : <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>}
      </div>
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

