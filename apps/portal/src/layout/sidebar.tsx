// Sidebar — admin-panel navigation: logo + app name + version, search, grouped nav
// with icons and badges, user card at the bottom. Collapsible (icon rail).
// Items come from nav-config.tsx; the user card and the Settings entry open the
// settings modal. Styled per DESIGN.md (14px/400 items, gray hover fill).
import { ChevronsLeft, ChevronsRight, LogOut, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { StatusDot } from "../components/ui/status-dot";
import { APP_VERSION } from "../lib/app-info";
import { useHealth } from "../lib/use-health";
import { cn } from "../lib/utils";
import { NAV_SECTIONS, type NavItem } from "./nav-config";

const HEALTH_TONE = { checking: "orange", up: "green", down: "red" } as const;
const COLLAPSE_KEY = "kintsugi-sidebar-collapsed";

function SidebarLink({
  item,
  collapsed,
  onAction,
}: {
  item: NavItem;
  collapsed: boolean;
  onAction?: () => void;
}): React.JSX.Element {
  const Icon = item.icon;
  const className = ({ isActive }: { isActive: boolean }): string =>
    cn(
      "flex h-9 items-center gap-2.5 rounded-[var(--geist-radius)] px-3 text-[14px] text-text-secondary hover:bg-hover hover:text-text",
      isActive && "bg-hover font-medium text-text",
      collapsed && "justify-center px-0",
    );

  if (onAction !== undefined) {
    return (
      <button type="button" onClick={onAction} title={collapsed ? item.label : undefined} className={className({ isActive: false })}>
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        {collapsed ? null : <span className="truncate">{item.label}</span>}
      </button>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined} className={className}>
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {collapsed || item.badge === undefined ? null : (
        <span className="ml-auto rounded-[var(--geist-pill-radius)] bg-recessed px-1.5 py-0.5 text-[11px] leading-4 text-text-muted">{item.badge}</span>
      )}
    </NavLink>
  );
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const health = useHealth();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.label.toLowerCase().includes(needle)),
    })).filter((section) => section.items.length > 0);
  }, [query]);

  const toggle = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col gap-4 px-3 py-5 transition-[width] duration-200",
        collapsed ? "w-16" : "w-72",
      )}
    >
      {/* Logo + app name + version */}
      <div className="flex items-center gap-2 px-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--geist-radius)] bg-text text-[13px] font-medium text-background">K</div>
        {collapsed ? null : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[15px] font-medium tracking-tight text-text">Kintsugi</span>
            <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-1.5 py-0.5 text-[11px] leading-4 text-text-muted">{APP_VERSION}</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--geist-radius)] text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
        >
          {collapsed ? <ChevronsRight className="size-4" strokeWidth={1.75} /> : <ChevronsLeft className="size-4" strokeWidth={1.75} />}
        </button>
      </div>

      {/* Search */}
      {collapsed ? null : (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="shadow-border h-9 w-full rounded-[var(--geist-radius)] bg-transparent pr-3 pl-8 text-[14px] text-text placeholder:text-text-muted focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
          />
        </label>
      )}

      {/* Navigation */}
      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {filtered.map((section) => (
          <div key={section.id} className="flex flex-col gap-1">
            {collapsed ? null : <p className="px-3 pb-1 text-[11px] font-medium tracking-wider text-text-muted uppercase">{section.label}</p>}
            {section.items.map((item) => (
              <SidebarLink
                key={`${section.id}-${item.id}`}
                item={item}
                collapsed={collapsed}
                onAction={item.action === "open-settings" ? onOpenSettings : undefined}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Status + user */}
      <div className="flex flex-col gap-3">
        <div className={cn("flex items-center gap-2 px-3 text-[12px] text-text-secondary", collapsed && "justify-center px-0")}>
          <StatusDot tone={HEALTH_TONE[health]} />
          {collapsed ? null : health === "up" ? "API connected" : health === "down" ? "API unreachable" : "API checking…"}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Open settings"
          className="shadow-border flex items-center gap-2.5 rounded-[var(--geist-radius)] p-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-recessed text-[12px] font-medium text-text">AD</div>
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-text">Admin</p>
              <p className="truncate text-[11px] text-text-muted">admin@kintsugi.local</p>
            </div>
          )}
        </button>
        {collapsed ? null : (
          <div className="flex justify-end px-1">
            <button
              type="button"
              aria-label="Sign out"
              className="flex size-7 items-center justify-center rounded-[var(--geist-radius)] text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
