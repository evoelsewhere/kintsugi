// Sidebar — primary navigation. Items 14px/400 #4D4D4D, hover promotes to #171717
// with a gray fill (DESIGN.md §4); active item uses the same fill at medium weight.
import { NavLink } from "react-router-dom";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/admin", label: "Admin", end: false },
  { to: "/delivery", label: "Delivery", end: false },
  { to: "/monitoring", label: "Monitoring", end: false },
  { to: "/governance", label: "Governance", end: false },
] as const;

export function Sidebar(): React.JSX.Element {
  return (
    <nav
      aria-label="Main"
      className="sticky top-[var(--header-height)] hidden h-[calc(100vh-var(--header-height))] w-60 shrink-0 flex-col gap-1 px-3 py-6 md:flex"
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "flex h-9 items-center rounded-[var(--geist-radius)] px-3 text-[14px] text-text-secondary hover:bg-hover hover:text-text",
              isActive && "bg-hover font-medium text-text",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
