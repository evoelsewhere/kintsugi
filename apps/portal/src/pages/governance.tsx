// Governance — the audit log (audit.read) with filters, the restricted records of job runs
// (restricted.read: listed without content; opening a run's records decrypts them and every
// record read is audited) and which permission governs what.
// URL: /governance?tab=audit|restricted|permissions&run=<top-level run id>

import { Check, Eye, FileLock2, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { Page } from "@/lib/api";
import { type AuditEntry, governanceApi } from "@/lib/api/governance";
import { identityApi } from "@/lib/api/identity";
import { jobRunsApi, type RestrictedRecord, type RestrictedRecordSummary } from "@/lib/api/job-runs";
import { projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";

type GovernanceTab = "audit" | "restricted" | "permissions";
const PAGE_SIZE = 25;

export function GovernancePage(): React.JSX.Element {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: { id: GovernanceTab; label: string }[] = [
    ...(can("audit.read") ? [{ id: "audit" as const, label: "Audit log" }] : []),
    ...(can("restricted.read") ? [{ id: "restricted" as const, label: "Restricted records" }] : []),
    { id: "permissions", label: "Permissions" },
  ];
  const tab = tabs.find((entry) => entry.id === params.get("tab"))?.id ?? tabs[0]!.id;

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Governance"]} />
      <PageHeading title="Governance" description="Who did what, the restricted records runs produced, and the permissions that guard them." />
      <Tabs
        label="Governance views"
        tabs={tabs}
        value={tab}
        onChange={(id) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set("tab", id);
              next.delete("run");
              return next;
            },
            { replace: true },
          )
        }
      />
      {tab === "audit" ? <AuditView /> : null}
      {tab === "restricted" ? <RestrictedView runFilter={params.get("run") ?? undefined} /> : null}
      {tab === "permissions" ? <PermissionsView /> : null}
    </div>
  );
}

function useProjectOptions(): { value: string; label: string; hint?: string }[] {
  const projects = useLoader("projects", projectsApi.list);
  return [{ value: "", label: "All projects" }, ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, hint: project.id }))];
}

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "restricted.read", label: "restricted.read", hint: "a restricted record was opened" },
];

function AuditView(): React.JSX.Element {
  const projectOptions = useProjectOptions();
  const [action, setAction] = useState("");
  const [projectId, setProjectId] = useState("");
  const [subject, setSubject] = useState("");
  const [offset, setOffset] = useState(0);
  const trimmed = subject.trim();
  const audit = useLoader<Page<AuditEntry>>(`audit/${action}/${projectId}/${trimmed}/${offset}`, () =>
    governanceApi.audit({
      ...(action === "" ? {} : { action }),
      ...(projectId === "" ? {} : { projectId }),
      ...(trimmed === "" ? {} : { subject: trimmed }),
      limit: PAGE_SIZE,
      offset,
    }),
  );
  const reset = (apply: () => void): void => {
    setOffset(0);
    apply();
  };

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Append-only, newest first. Entries name what was acted on, never its content.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select value={action} options={ACTION_OPTIONS} onChange={(value) => reset(() => setAction(value))} />
          </div>
          <div className="w-52">
            <Select value={projectId} options={projectOptions} onChange={(value) => reset(() => setProjectId(value))} />
          </div>
          <Input className="w-52" placeholder="Subject (e.g. a job run id)" aria-label="Subject" value={subject} onChange={(event) => reset(() => setSubject(event.target.value))} />
          <Button size="icon" variant="ghost" aria-label="Refresh the audit log" onClick={() => void audit.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={audit} rows={5}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState icon={ScrollText} title="No audit entries" description={action === "" && projectId === "" && trimmed === "" ? "Audited actions, such as opening a restricted record, appear here." : "No entry matches these filters."} />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[13px]">
                    <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                      <tr>
                        <th className="py-1.5 pr-2 font-normal">When</th>
                        <th className="px-2 py-1.5 font-normal">Who</th>
                        <th className="px-2 py-1.5 font-normal">Action</th>
                        <th className="px-2 py-1.5 font-normal">Project</th>
                        <th className="px-2 py-1.5 font-normal">Subject</th>
                        <th className="py-1.5 pl-2 font-normal">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((entry) => (
                        <AuditRow key={entry.id} entry={entry} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <PagerRow page={page} offset={offset} onOffset={setOffset} />
              </>
            )
          }
        </Loaded>
      </div>
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const username = typeof entry.detail["username"] === "string" ? entry.detail["username"] : undefined;
  const detail = Object.entries(entry.detail).filter(([key]) => key !== "username");
  return (
    <tr className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
      <td className="py-2 pr-2 text-[12px] whitespace-nowrap text-text-secondary" title={formatDateTime(entry.at)}>
        {formatRelative(entry.at)}
      </td>
      <td className="px-2 py-2 text-text" title={`User id ${entry.actor}`}>
        {username ?? entry.actor}
      </td>
      <td className="px-2 py-2">
        <Badge className="font-mono">{entry.action}</Badge>
      </td>
      <td className="px-2 py-2 text-text-secondary">{entry.projectId ?? "—"}</td>
      <td className="max-w-[200px] truncate px-2 py-2 font-mono text-[12px] text-text-secondary" title={entry.subject}>
        {entry.subject ?? "—"}
      </td>
      <td className="py-2 pl-2 text-[12px] text-text-secondary">
        {detail.length === 0
          ? "—"
          : detail.map(([key, value]) => (
              <p key={key} className="break-words">
                <span className="text-text-muted">{key}:</span> {typeof value === "string" ? value : JSON.stringify(value)}
              </p>
            ))}
      </td>
    </tr>
  );
}

function PagerRow({ page, offset, onOffset }: { page: Page<unknown>; offset: number; onOffset: (offset: number) => void }): React.JSX.Element | null {
  if (page.total <= page.limit) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-text-muted">
      <span>
        {offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}
      </span>
      <Button size="small" variant="ghost" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - page.limit))}>
        Previous
      </Button>
      <Button size="small" variant="ghost" disabled={offset + page.limit >= page.total} onClick={() => onOffset(offset + page.limit)}>
        Next
      </Button>
    </div>
  );
}

interface RunGroup {
  topLevelRunId: string;
  projectId: string;
  applicationId?: string;
  runName: string;
  records: RestrictedRecordSummary[];
}

function groupByRun(records: RestrictedRecordSummary[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const record of records) {
    const group = groups.get(record.topLevelRunId) ?? {
      topLevelRunId: record.topLevelRunId,
      projectId: record.projectId,
      ...(record.applicationId === undefined ? {} : { applicationId: record.applicationId }),
      runName: record.runName,
      records: [],
    };
    group.records.push(record);
    groups.set(record.topLevelRunId, group);
  }
  return [...groups.values()];
}

function RestrictedView({ runFilter }: { runFilter: string | undefined }): React.JSX.Element {
  const projectOptions = useProjectOptions();
  const toast = useToast();
  const [projectId, setProjectId] = useState("");
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState<RunGroup | null>(null);
  const [opened, setOpened] = useState<{ group: RunGroup; records: RestrictedRecord[] } | null>(null);
  const records = useLoader(`restricted/${projectId}/${runFilter ?? ""}/${offset}`, () =>
    jobRunsApi.restrictedRecords({ ...(projectId === "" ? {} : { projectId }), ...(runFilter === undefined ? {} : { jobRunId: runFilter }), limit: 100, offset }),
  );
  const [, setParams] = useSearchParams();

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Restricted records</CardTitle>
          <CardDescription>
            Files runs marked restricted (for example a credential inventory). They are encrypted and never committed. The list shows names only; opening a run&apos;s records decrypts them and records each
            read in the audit log.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {runFilter === undefined ? null : (
            <Button
              size="small"
              variant="ghost"
              onClick={() =>
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete("run");
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              Run {runFilter.slice(0, 8)} · show all
            </Button>
          )}
          <div className="w-52">
            <Select
              value={projectId}
              options={projectOptions}
              onChange={(value) => {
                setOffset(0);
                setProjectId(value);
              }}
            />
          </div>
          <Button size="icon" variant="ghost" aria-label="Refresh restricted records" onClick={() => void records.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={records} rows={4}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState icon={FileLock2} title="No restricted records" description="Runs that find sensitive material store it here instead of committing it." />
            ) : (
              <>
                <ul className="flex flex-col">
                  {groupByRun(page.items).map((group, index) => (
                    <li key={group.topLevelRunId} className={cn("flex items-start gap-3 py-2.5", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
                      <FileLock2 className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-text">
                          Stage {group.runName}{" "}
                          <Link to={deliveryLink({ projectId: group.projectId, applicationId: group.applicationId, runId: group.topLevelRunId })} className="text-[12px] text-accent hover:underline">
                            {group.projectId}
                            {group.applicationId === undefined ? "" : ` / ${group.applicationId}`}
                          </Link>
                        </p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {group.records.map((record) => (
                            <li key={`${record.jobRunId}-${record.path}`} className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
                              <span className="font-mono text-text">{record.path}</span>
                              <span className="text-text-muted">
                                {formatBytes(record.size)}
                                {record.stepName === undefined ? "" : ` · step ${record.stepName}`} · {formatRelative(record.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Button size="small" variant="ghost" onClick={() => setConfirm(group)}>
                        <Eye className="size-4" />
                        Open
                      </Button>
                    </li>
                  ))}
                </ul>
                <PagerRow page={page} offset={offset} onOffset={setOffset} />
              </>
            )
          }
        </Loaded>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title="Open restricted records?"
        confirmLabel="Open and record in the audit log"
        busyLabel="Opening…"
        confirmVariant="solid"
        onConfirm={async () => {
          if (confirm === null) return;
          const content = await jobRunsApi.openRestricted(confirm.projectId, confirm.topLevelRunId);
          setOpened({ group: confirm, records: content });
          toast.success("Read recorded in the audit log", `${content.length} record${content.length === 1 ? "" : "s"} of stage ${confirm.runName}`);
        }}
        onClose={() => setConfirm(null)}
      >
        The {confirm?.records.length ?? 0} restricted record{confirm?.records.length === 1 ? "" : "s"} of this run are decrypted for you. Each read is recorded in the audit log with your name, the
        run and the path. Do not copy the content into tickets, chats or commits.
      </ConfirmDialog>

      <Modal open={opened !== null} size="wide" title={opened === null ? "" : `Restricted records · stage ${opened.group.runName}`} description="This read is recorded in the audit log." onClose={() => setOpened(null)}>
        <div className="flex flex-col gap-4">
          {opened?.records.map((record) => (
            <section key={`${record.jobRunId}-${record.path}`} className="flex flex-col gap-1">
              <p className="font-mono text-[12px] text-text">{record.path}</p>
              <pre className="max-h-[50vh] overflow-auto rounded-[var(--geist-radius)] bg-recessed p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text">{record.content}</pre>
            </section>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

function PermissionsView(): React.JSX.Element {
  const { can, user } = useAuth();
  const catalog = useLoader(can("roles.manage") ? "permissions" : "permissions/none", () => (can("roles.manage") ? identityApi.permissions() : Promise.resolve(null)));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            Reading projects, runs, writes and the monitoring views needs a session. Changing state or revealing sensitive content needs a permission — audit.read for the audit log,
            restricted.read for restricted records — granted to roles in{" "}
            <Link to="/members" className="text-accent hover:underline">
              Members &amp; Permissions
            </Link>
            .
          </CardDescription>
        </div>
        <ShieldCheck className="size-5 shrink-0 text-text-muted" strokeWidth={1.5} />
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={catalog} rows={4}>
          {(permissions) =>
            permissions === null ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-text-muted">Your effective permissions (the full catalog is visible with roles.manage):</p>
                <div className="flex flex-wrap gap-1.5">
                  {(user?.permissions ?? []).length === 0 ? (
                    <span className="text-[12px] text-text-muted">None beyond reading.</span>
                  ) : (
                    (user?.permissions ?? []).map((code) => (
                      <Badge key={code} className="font-mono">
                        {code}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                  <tr>
                    <th className="py-1.5 pr-2 font-normal">Permission</th>
                    <th className="px-2 py-1.5 font-normal">Group</th>
                    <th className="px-2 py-1.5 font-normal">Governs</th>
                    <th className="py-1.5 pl-2 text-right font-normal">You</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission.code} className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                      <td className="py-2 pr-2 font-mono text-[12px] text-text">{permission.code}</td>
                      <td className="px-2 py-2 text-[12px] text-text-muted">{permission.group}</td>
                      <td className="px-2 py-2 text-text-secondary">{permission.description}</td>
                      <td className="py-2 pl-2 text-right">{can(permission.code) ? <Check className="ml-auto size-4 text-[var(--ds-status-green)]" aria-label="granted" /> : <span className="text-[12px] text-text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loaded>
      </div>
    </Card>
  );
}
