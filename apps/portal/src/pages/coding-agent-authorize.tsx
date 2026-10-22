import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { agentContextApi } from "@/lib/api/agent-context";
import { useAuth } from "@/lib/auth";
import { errorText } from "@/lib/format";
import {
  parseCodingAgentAuthorizationRequest,
  safeCodingAgentReturnTo,
  validatedAuthorizationRedirect,
} from "./agent-context/coding-agent-install-model";

export function CodingAgentAuthorizePage(): React.JSX.Element {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const request = parseCodingAgentAuthorizationRequest(location.search);
  const returnTo = safeCodingAgentReturnTo(`${location.pathname}${location.search}`);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background text-[13px] text-text-muted">Checking your Kintsugi session…</div>;
  if (user === null) return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;

  async function approve(): Promise<void> {
    if (request === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agentContextApi.authorizeCodingAgent(request);
      window.location.assign(validatedAuthorizationRedirect(result.redirectTo, request));
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  const home = <a className="text-accent hover:underline" href="/">Return to Kintsugi</a>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-5">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-recessed text-text-secondary"><ShieldCheck className="size-4" strokeWidth={1.75} /></span>
            <div className="min-w-0">
              <CardTitle className="text-[16px]">Connect a coding agent to Kintsugi</CardTitle>
              <CardDescription>Review the project scope before allowing this local client to read workflow context.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {request === undefined ? <div role="alert" className="flex flex-col gap-3 text-[13px] text-text-secondary"><p>This sign-in request is incomplete or invalid. Return to the coding agent and try again.</p>{home}</div> : declined ? <div role="status" className="flex flex-col gap-3 text-[13px] text-text-secondary"><p>No connection was created. You can close this page or return to Kintsugi.</p>{home}</div> : (
            <>
              <section aria-label="Requested access" className="overflow-hidden rounded-lg bg-surface shadow-border">
                <div className="flex items-start gap-3 px-3.5 py-3 [box-shadow:inset_2px_0_0_0_var(--ds-accent)]">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-text">Project access</p>
                    <p className="mt-1 break-all font-mono text-[12px] text-text-secondary">{request.projectId}</p>
                  </div>
                  <span className="shrink-0 rounded bg-recessed px-1.5 py-0.5 text-[11px] text-text-secondary">Read only</span>
                </div>
                <dl className="divide-y divide-black/[0.06] text-[12px] dark:divide-white/[0.08]">
                  <div className="flex flex-wrap justify-between gap-2 px-3.5 py-2"><dt className="text-text-muted">Client</dt><dd className="font-medium text-text">{request.clientName}</dd></div>
                  <div className="flex flex-wrap justify-between gap-2 px-3.5 py-2"><dt className="text-text-muted">Can read</dt><dd className="text-right text-text-secondary">Tasks, project documents, status, reviews and events</dd></div>
                  <div className="flex flex-wrap justify-between gap-2 px-3.5 py-2"><dt className="text-text-muted">Cannot do</dt><dd className="text-right text-text-secondary">Edit Kintsugi, change tasks, or write to repositories</dd></div>
                </dl>
              </section>
              <p className="mt-3 text-[12px] leading-5 text-text-secondary">The connection renews while it is within your administrator&apos;s maximum age. You can revoke it from your Coding Agent Workflow page at any time.</p>
              {!can("member.read") ? <p role="alert" className="mt-3 text-[12px] text-[var(--ds-status-red)]">Your account does not have Coding Agent Workflow read permission.</p> : null}
              {error === null ? null : <p role="alert" className="mt-3 text-[12px] text-[var(--ds-status-red)]">{error}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setDeclined(true)}>Decline</Button>
                <Button variant="solid" disabled={busy || !can("member.read")} onClick={() => void approve()}>{busy ? "Connecting…" : "Allow project access"}<ArrowUpRight className="size-3.5" /></Button>
              </div>
              <p className="mt-3 text-right text-[11px] text-text-muted">Signed in as {user.displayName} · {home}</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
