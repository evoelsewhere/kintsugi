// Navigation configuration — the single place to add or reorder panel entries.
// Adding a page: append an item here and register its route in App.tsx.
import {
  Activity,
  BookOpenText,
  Blocks,
  FolderKanban,
  Gauge,
  type LucideIcon,
  Package,
  ShieldCheck,
  Users,
} from "lucide-react";

export interface NavChildItem {
  id: string;
  label: string;
  to: string;
  /** Group heading shown above the first child of a group. */
  group?: string;
  /** Small muted note on the right, e.g. "planned". */
  badge?: string;
}

/** Children computed at runtime by the sidebar (layout/dynamic-nav.ts). */
export type NavChildrenSource = "delivery-stages";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Small pill on the right, e.g. counts or "soon". */
  badge?: string;
  /** Match the route exactly (root paths). */
  end?: boolean;
  /** Non-navigation entry: handled by the sidebar (e.g. open the settings modal). */
  action?: "open-settings";
  /** Nested destinations displayed while the parent section is active. */
  children?: NavChildItem[];
  /** Nested destinations loaded at runtime instead of `children`. */
  childrenFrom?: NavChildrenSource;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: Gauge, to: "/", end: true },
      { id: "delivery", label: "Delivery", icon: Package, to: "/delivery", childrenFrom: "delivery-stages" },
      { id: "monitoring", label: "Monitoring", icon: Activity, to: "/monitoring" },
      { id: "governance", label: "Governance", icon: ShieldCheck, to: "/governance" },
      { id: "coding-agent-guide", label: "Developer docs", icon: BookOpenText, to: "/developer" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { id: "projects", label: "Projects", icon: FolderKanban, to: "/projects" },
      { id: "plugins", label: "Plugins", icon: Blocks, to: "/plugins" },
      { id: "members", label: "Members & Permissions", icon: Users, to: "/members" },
    ],
  },
];
