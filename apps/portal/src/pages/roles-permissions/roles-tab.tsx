// Roles & Permissions — permission matrix: permissions (grouped) as rows, roles as
// columns. Grants save immediately on toggle. Permission codes are dynamic — new
// codes added by migration appear here automatically (core.permission).
// The matrix scrolls both ways: sticky header row and sticky first column.

import { Plus, Search, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { identityApi, type PermissionRecord, type RoleRecord } from "../../lib/api/identity";

export function RolesTab(): React.JSX.Element {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState({ id: "", name: "", description: "" });

  const load = async (): Promise<void> => {
    try {
      const [roleList, catalog] = await Promise.all([identityApi.roles(), identityApi.permissions()]);
      setRoles(roleList);
      setPermissions(catalog);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = permissions.filter(
      (permission) =>
        needle === "" ||
        permission.code.toLowerCase().includes(needle) ||
        permission.description.toLowerCase().includes(needle) ||
        permission.group.toLowerCase().includes(needle),
    );
    const map = new Map<string, PermissionRecord[]>();
    for (const permission of visible) {
      map.set(permission.group, [...(map.get(permission.group) ?? []), permission]);
    }
    return [...map.entries()];
  }, [permissions, query]);

  /** Optimistic toggle — the grant is saved immediately. */
  function toggle(role: RoleRecord, code: string): void {
    const granted = role.permissions.includes(code);
    const next = granted ? role.permissions.filter((entry) => entry !== code) : [...role.permissions, code];
    setRoles((prev) => prev.map((entry) => (entry.id === role.id ? { ...entry, permissions: next } : entry)));
    setSavingRole(role.id);
    identityApi
      .setPermissions(role.id, next)
      .then((updated) => {
        setRoles((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        setError(null);
      })
      .catch((saveError: unknown) => {
        setRoles((prev) => prev.map((entry) => (entry.id === role.id ? role : entry)));
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      })
      .finally(() => setSavingRole(null));
  }

  async function createSubRole(): Promise<void> {
    try {
      await identityApi.createSubRole(newRole);
      setDialogOpen(false);
      setNewRole({ id: "", name: "", description: "" });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  }

  async function removeSubRole(id: string): Promise<void> {
    if (!window.confirm(`Remove sub-role "${id}"?`)) return;
    try {
      await identityApi.deleteSubRole(id);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
          <Input
            value={query}
            placeholder="Filter permissions…"
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {savingRole === null ? (
            <span className="text-[11px] text-text-muted">changes save immediately</span>
          ) : (
            <span className="text-[11px] text-text-muted">saving…</span>
          )}
          <Button size="small" variant="solid" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            Add sub-role
          </Button>
        </div>
      </div>

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      {/* Permission matrix: rows = permissions (grouped), columns = roles */}
      <div className="shadow-border min-h-0 flex-1 overflow-auto rounded-xl">
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 min-w-64 bg-surface px-4 py-2.5 text-[11px] font-medium tracking-wider text-text-muted uppercase [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                Permission
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  className="sticky top-0 z-10 min-w-24 bg-surface px-2 py-2 text-center align-bottom [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]"
                >
                  <p className="text-[13px] text-text">{role.name}</p>
                  <p className="flex items-center justify-center gap-1 text-[11px] text-text-muted">
                    {role.kind === "primary" ? "primary" : "sub-role"}
                    {role.kind === "sub" ? (
                      <button
                        type="button"
                        aria-label={`Remove ${role.id}`}
                        onClick={() => void removeSubRole(role.id)}
                        className="flex size-5 items-center justify-center rounded-[var(--geist-radius)] text-text-muted hover:bg-hover hover:text-[var(--ds-status-red)] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([group, items]) => (
              <Fragment key={group}>
                <tr>
                  <td colSpan={roles.length + 1} className="bg-recessed px-4 py-1.5">
                    <p className="text-[11px] font-medium tracking-wider text-text-muted uppercase">{group}</p>
                  </td>
                </tr>
                {items.map((permission) => (
                  <tr key={permission.code} className="hover:bg-hover/40">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2 [box-shadow:1px_0_0_0_rgba(0,0,0,0.06)]">
                      <p className="text-[13px] text-text">{permission.code}</p>
                      <p className="text-[11px] text-text-muted">{permission.description}</p>
                    </td>
                    {roles.map((role) => (
                      <td key={role.id} className="px-2 py-2 text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={role.permissions.includes(permission.code)}
                            onChange={() => toggle(role, permission.code)}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            {grouped.length === 0 ? (
              <tr>
                <td colSpan={roles.length + 1} className="px-4 py-8 text-center text-[13px] text-text-secondary">
                  No permissions match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal
        open={dialogOpen}
        title="Add sub-role"
        description="Sub-roles are defined by admins (dev, ba, tester by default) and share the permission catalog."
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <Button size="small" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="small" variant="solid" onClick={() => void createSubRole()} disabled={newRole.id === "" || newRole.name === ""}>
              Create sub-role
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Id" hint="Lowercase kebab-case, e.g. analyst.">
            <Input value={newRole.id} placeholder="analyst" onChange={(event) => setNewRole((prev) => ({ ...prev, id: event.target.value }))} />
          </Field>
          <Field label="Name">
            <Input value={newRole.name} placeholder="Analyst" onChange={(event) => setNewRole((prev) => ({ ...prev, name: event.target.value }))} />
          </Field>
          <Field label="Description">
            <Input value={newRole.description} placeholder="What this sub-role is for" onChange={(event) => setNewRole((prev) => ({ ...prev, description: event.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
