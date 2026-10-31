// Which permission each administrative Settings section needs (the API checks the same codes). The sidebar shows its
// Settings entry under Administration to anyone who holds one of them; everyone reaches Settings from the account menu.

export const SETTINGS_SECTION_PERMISSIONS = {
  providers: "providers.manage",
  mcp: "mcp.manage",
  git: "git.manage",
  sandbox: "sandbox.manage",
  telemetryExport: "telemetry.manage",
  security: "security.manage",
} as const;

/** The permissions that make Settings an administration area for a person: any one of them. */
export const SETTINGS_ADMIN_PERMISSIONS: readonly string[] = Object.values(SETTINGS_SECTION_PERMISSIONS);
