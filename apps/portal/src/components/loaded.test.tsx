// Loaded is what the lists (Projects first) show before, after and instead of their data. Rendered to markup, so it
// runs without a browser: the portal has no DOM test environment.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Loader } from "@/lib/use-loader";
import { Loaded } from "./loaded";

const loader = (state: Partial<Loader<string[]>>): Loader<string[]> => ({ data: undefined, error: null, loading: true, slow: false, reload: async () => undefined, ...state });

const projects = (state: Partial<Loader<string[]>>): string =>
  renderToStaticMarkup(<Loaded loader={loader(state)}>{(list) => (list.length === 0 ? <p>No projects yet.</p> : list.map((name) => <p key={name}>{name}</p>))}</Loaded>);

describe("Loaded", () => {
  it("shows the loading state while the request is pending, never the empty state", () => {
    const html = projects({});
    expect(html).toContain('aria-label="Loading"');
    expect(html).not.toContain("No projects yet.");
  });

  it("says when a pending request is slow, with a retry", () => {
    expect(projects({ slow: true })).toContain("Still loading");
  });

  it("shows the empty state only after a successful empty answer", () => {
    const html = projects({ data: [], loading: false });
    expect(html).toContain("No projects yet.");
    expect(html).not.toContain('aria-label="Loading"');
  });

  it("shows the list once it has loaded", () => {
    expect(projects({ data: ["billing-qa"], loading: false })).toContain("billing-qa");
  });

  it("shows only the error when the first load fails", () => {
    const html = projects({ error: "Request failed: /api/admin/projects", loading: false });
    expect(html).toContain("Could not load: Request failed: /api/admin/projects");
    expect(html).not.toContain("No projects yet.");
    expect(html).not.toContain('aria-label="Loading"');
  });

  it("keeps the last data when a refresh fails, and says so", () => {
    const html = projects({ data: ["billing-qa"], error: "boom", loading: false });
    expect(html).toContain("Refresh failed: boom");
    expect(html).toContain("billing-qa");
  });
});
