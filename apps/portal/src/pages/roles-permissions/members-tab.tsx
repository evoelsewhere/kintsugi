// Members table — the primary content of Members & Permissions: members with
// always-visible filters (search, role, status) and management dialogs.

import { Plus, Search, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select, type SelectOption } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import { permissionsOf } from "@/lib/access";
import { identityApi, type RoleRecord, type UserRecord } from "@/lib/api/identity";
import { formErrorsOf } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import { passwordProblem, usernameProblem } from "./member-form";
import { AccessOverview, MembersSummary } from "./members-insights";

/** The fields a refusal of the API can name. */
const FORM_FIELDS = ["username", "password", "email", "displayName"] as const;
type FormField = (typeof FORM_FIELDS)[number];

interface FormState {
  id: string | null;
  username: string;
  displayName: string;
  email: string;
  password: string;
  primaryRole: string;
  subRoles: string[];
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  username: "",
  displayName: "",
  email: "",
  password: "",
  primaryRole: "user",
  subRoles: [],
  enabled: true,
};

const STATUS_OPTIONS: SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

export interface MembersTableProps {
  /** Opens the Roles & Permissions modal (action in the toolbar). */
  onManageRoles: () => void;
}

export function MembersTable({ onManageRoles }: MembersTableProps): React.JSX.Element {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** What the API refused, per field; cleared on the field as soon as it changes. */
  const [serverErrors, setServerErrors] = useState<Partial<Record<FormField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<UserRecord | null>(null);
  const toast = useToast();

  const primaryRoles: RoleRecord[] = useMemo(() => roles.filter((role) => role.kind === "primary"), [roles]);
  const subRoles: RoleRecord[] = useMemo(() => roles.filter((role) => role.kind === "sub"), [roles]);

  const load = async (): Promise<void> => {
    try {
      const [userList, roleList] = await Promise.all([identityApi.users(), identityApi.roles()]);
      setUsers(userList);
      setRoles(roleList);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText =
        needle === "" ||
        user.username.toLowerCase().includes(needle) ||
        user.displayName.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle);
      const matchesRole = roleFilter === "all" || user.roleIds.includes(roleFilter);
      const matchesStatus = statusFilter === "all" || (statusFilter === "enabled" ? user.enabled : !user.enabled);
      return matchesText && matchesRole && matchesStatus;
    });
  }, [users, query, roleFilter, statusFilter]);

  const roleOptions: SelectOption[] = [
    { value: "all", label: "All roles" },
    ...roles.map((role) => ({ value: role.id, label: role.name, hint: `${role.kind} · ${users.filter((user) => user.roleIds.includes(role.id)).length}` })),
  ];

  function openCreate(): void {
    setForm({ ...EMPTY_FORM, primaryRole: primaryRoles.at(-1)?.id ?? "user" });
    setFormError(null);
    setServerErrors({});
    setDialogOpen(true);
  }

  function openEdit(user: UserRecord): void {
    setForm({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      password: "",
      primaryRole: user.roleIds.find((id) => primaryRoles.some((role) => role.id === id)) ?? "user",
      subRoles: user.roleIds.filter((id) => subRoles.some((role) => role.id === id)),
      enabled: user.enabled,
    });
    setFormError(null);
    setServerErrors({});
    setDialogOpen(true);
  }

  function toggleSubRole(id: string): void {
    setForm((prev) => ({
      ...prev,
      subRoles: prev.subRoles.includes(id) ? prev.subRoles.filter((entry) => entry !== id) : [...prev.subRoles, id],
    }));
  }

  /** Changes one text field of the form and drops what the API said about its old value. */
  function setField(field: FormField, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
    setServerErrors((prev) => {
      if (prev[field] === undefined) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const usernameError = form.id === null ? (usernameProblem(form.username) ?? serverErrors.username) : undefined;
  const passwordError = passwordProblem(form.password) ?? serverErrors.password;
  const invalid = usernameError !== undefined || passwordError !== undefined;

  async function save(): Promise<void> {
    setSaving(true);
    setFormError(null);
    setServerErrors({});
    try {
      const roleIds = [form.primaryRole, ...form.subRoles];
      if (form.id === null) {
        await identityApi.createUser({
          username: form.username,
          password: form.password,
          email: form.email,
          displayName: form.displayName,
          roleIds,
        });
      } else {
        await identityApi.updateUser(form.id, {
          email: form.email,
          displayName: form.displayName,
          enabled: form.enabled,
          roleIds,
        });
        if (form.password !== "") await identityApi.setPassword(form.id, form.password);
      }
      setDialogOpen(false);
      setError(null);
      toast.success(form.id === null ? `Member ${form.username} created` : `Member ${form.username} saved`);
      await load();
    } catch (saveError) {
      // Shown inside the dialog — the page behind it is covered by the overlay: on the field it names, else below.
      const errors = formErrorsOf(saveError, FORM_FIELDS);
      setServerErrors(errors.fields);
      setFormError(errors.form);
    } finally {
      setSaving(false);
    }
  }

  /** Runs from the confirm dialog, which keeps an error on screen instead of closing. */
  async function remove(user: UserRecord): Promise<void> {
    await identityApi.deleteUser(user.id);
    toast.success(`Member ${user.username} removed`);
    await load();
  }

  const roleLabel = (id: string): string => roles.find((role) => role.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: filters always visible + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
          <Input value={query} placeholder="Search name, username, email…" className="pl-8" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select value={roleFilter} options={roleOptions} className="w-48" onChange={setRoleFilter} />
        <Select value={statusFilter} options={STATUS_OPTIONS} className="w-40" onChange={setStatusFilter} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="small" variant="ghost" onClick={onManageRoles}>
            <ShieldCheck className="size-4" />
            Roles &amp; Permissions
          </Button>
          <Button size="small" variant="solid" onClick={openCreate}>
            <Plus className="size-4" />
            Add member
          </Button>
        </div>
      </div>

      <MembersSummary users={users} roles={roles} />

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      {/* Members table */}
      <div className="shadow-border overflow-hidden rounded-xl">
        <div className="hidden grid-cols-[1.2fr_1fr_1.4fr_5.5rem_auto] gap-3 px-4 py-2 text-[11px] tracking-wider text-text-muted uppercase sm:grid">
          <span>Member</span>
          <span>Username</span>
          <span>Roles</span>
          <span className="text-right">Permissions</span>
          <span className="w-20" />
        </div>
        {filtered.map((user, index) => (
          <div
            key={user.id}
            className={cn(
              "grid grid-cols-1 items-center gap-2 px-4 py-2.5 sm:grid-cols-[1.2fr_1fr_1.4fr_5.5rem_auto] sm:gap-3",
              index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] text-text">{user.displayName || user.username}</p>
              <p className="truncate text-[11px] text-text-muted">{user.email || "—"}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-text-secondary">
              <StatusDot tone={user.enabled ? "green" : "orange"} />
              {user.username}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {user.roleIds.map((id) => (
                <span key={id} className="rounded-[var(--geist-pill-radius)] bg-recessed px-1.5 py-0.5 text-[11px] text-text-secondary">
                  {roleLabel(id)}
                </span>
              ))}
            </div>
            <span className="text-[12px] text-text-secondary tabular-nums sm:text-right" title="Distinct permissions through all of the member's roles">
              {permissionsOf(user, roles).size}
            </span>
            <div className="flex items-center gap-1">
              <Button size="small" variant="ghost" onClick={() => openEdit(user)}>
                <Settings2 className="size-4" />
                Edit
              </Button>
              <Button size="icon" variant="danger" aria-label={`Remove ${user.username}`} onClick={() => setRemoveTarget(user)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-text-secondary">
            {users.length === 0 ? "No members yet." : "No members match the filters."}
          </p>
        ) : null}
      </div>

      <AccessOverview users={users} roles={roles} />

      {/* Create / edit member */}
      <Modal
        open={dialogOpen}
        title={form.id === null ? "Add member" : `Edit ${form.username}`}
        description="Primary role defines what the member can do; sub-roles refine it."
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <Button size="small" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="solid"
              onClick={() => void save()}
              disabled={saving || invalid || (form.id === null && (form.username === "" || form.password === ""))}
            >
              {saving ? "Saving…" : form.id === null ? "Create member" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {form.id === null ? (
            <Field label="Username" hint="Lowercase kebab-case, unique." error={usernameError}>
              <Input
                value={form.username}
                placeholder="jane-doe"
                autoComplete="off"
                aria-invalid={usernameError === undefined ? undefined : true}
                onChange={(event) => setField("username", event.target.value)}
              />
            </Field>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Display name" error={serverErrors.displayName}>
              <Input value={form.displayName} placeholder="Jane Doe" onChange={(event) => setField("displayName", event.target.value)} />
            </Field>
            <Field label="Email" error={serverErrors.email}>
              <Input value={form.email} placeholder="jane@example.com" onChange={(event) => setField("email", event.target.value)} />
            </Field>
          </div>
          <Field label={form.id === null ? "Password" : "Password (leave blank to keep)"} hint="At least 8 characters." error={passwordError}>
            <Input
              type="password"
              value={form.password}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={passwordError === undefined ? undefined : true}
              onChange={(event) => setField("password", event.target.value)}
            />
          </Field>
          <Field label="Primary role">
            <Select
              value={form.primaryRole}
              options={primaryRoles.map((role) => ({ value: role.id, label: role.name, hint: role.id }))}
              onChange={(value) => setForm((prev) => ({ ...prev, primaryRole: value }))}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] leading-5 text-text">Sub-roles</span>
            {subRoles.map((role) => (
              <Checkbox key={role.id} checked={form.subRoles.includes(role.id)} onChange={() => toggleSubRole(role.id)} label={role.name} />
            ))}
          </div>
          {form.id === null ? null : (
            <Checkbox checked={form.enabled} onChange={(value) => setForm((prev) => ({ ...prev, enabled: value }))} label="Enabled" />
          )}
          {formError === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{formError}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove member?"
        description={removeTarget === null ? undefined : `Remove ${removeTarget.displayName || removeTarget.username} (${removeTarget.username})?`}
        confirmLabel="Remove member"
        busyLabel="Removing…"
        onConfirm={() => (removeTarget === null ? Promise.resolve() : remove(removeTarget))}
        onClose={() => setRemoveTarget(null)}
      >
        <p className="text-[13px] text-text-secondary">
          The member can no longer sign in. The removal is recorded in the audit log.
        </p>
      </ConfirmDialog>
    </div>
  );
}
