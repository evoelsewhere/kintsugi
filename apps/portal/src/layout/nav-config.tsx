// Navigation configuration — the single place to add or reorder panel entries.
// Adding a page: append an item here and register its route in App.tsx.
import {
  Activity,
  Gauge,
  type LucideIcon,
  Package,
  ShieldCheck,
  Users,
} from "lucide-react";
import { DELIVERY_AREAS } from "../lib/delivery-areas";

export interface NavChildItem {
  id: string;
  label: string;
  to: string;
}

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
      {
        id: "delivery",
        label: "Delivery",
        icon: Package,
        to: "/delivery",
        children: DELIVERY_AREAS.map((area) => ({
          id: area.id,
          label: area.title,
          to: `/delivery/${area.id}`,
        })),
      },
      { id: "monitoring", label: "Monitoring", icon: Activity, to: "/monitoring" },
      { id: "governance", label: "Governance", icon: ShieldCheck, to: "/governance" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { id: "members", label: "Members & Permissions", icon: Users, to: "/members" },
    ],
  },
];
