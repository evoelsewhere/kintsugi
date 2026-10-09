// Application shell: fixed header, persistent sidebar, content capped at
// --geist-page-width with --geist-page-margin padding (DESIGN.md §5).
import { Outlet } from "react-router-dom";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

export function AppShell(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[var(--geist-page-width)] px-6 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
