// Commit identity (Settings → Git): the name and email of kintsugi-bot, author and committer of
// every commit the worker makes to a document repo (ADR-0019). An installation setting; the
// worker reads it for each write. Use an address the Git server maps to the bot account to
// link commits to it.

import { GitCommitHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type CommitIdentityView, gitApi } from "@/lib/api/git";

const PLAIN_EMAIL = /^[^\s<>@]+@[^\s<>@]+$/;
// Control characters, as Git refuses them in an identity.
const CONTROL = /\p{Cc}/u;

/** The same rules the API and the worker apply; empty when the identity is usable. */
function problems(name: string, email: string): string[] {
  const found: string[] = [];
  if (name.trim() === "") found.push("Enter a name.");
  else if (name.trim().length > 100) found.push("The name is longer than 100 characters.");
  if (/[<>]/.test(name) || CONTROL.test(name)) found.push("The name may not contain < or >.");
  if (!PLAIN_EMAIL.test(email.trim()) || email.trim().length > 254) found.push("Enter a plain email address, such as bot@example.com.");
  return found;
}

export function CommitIdentityCard(): React.JSX.Element {
  const [stored, setStored] = useState<CommitIdentityView | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    gitApi.commitIdentity().then(
      (identity) => {
        if (!active) return;
        setStored(identity);
        setName(identity.name);
        setEmail(identity.email);
      },
      (error: unknown) => {
        if (active) setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const invalid = problems(name, email);
  const changed = stored !== null && (name.trim() !== stored.name || email.trim() !== stored.email);

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await gitApi.setCommitIdentity({ name: name.trim(), email: email.trim() });
      setStored(saved);
      setName(saved.name);
      setEmail(saved.email);
      setMessage({ tone: "ok", text: "Saved. The next document write uses this identity." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="px-4 pt-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitCommitHorizontal className="size-4 text-text-secondary" strokeWidth={1.5} />
            Commit identity
          </CardTitle>
          <CardDescription>
            Author and committer of every commit Kintsugi makes to a document repo. Use an address your Git server maps to the bot account to link commits to it.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 pb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="commit-identity-name">
            <Input id="commit-identity-name" value={name} maxLength={100} disabled={stored === null} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email" htmlFor="commit-identity-email">
            <Input id="commit-identity-email" type="email" value={email} maxLength={254} disabled={stored === null} onChange={(event) => setEmail(event.target.value)} />
          </Field>
        </div>
        {changed && invalid.length > 0 ? <p className="text-[12px] text-[var(--ds-status-red)]">{invalid.join(" ")}</p> : null}
        {message === null ? null : (
          <p className={`text-[12px] ${message.tone === "error" ? "text-[var(--ds-status-red)]" : "text-text-secondary"}`}>{message.text}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-text-muted">
            {stored === null ? "Loading…" : stored.isDefault ? "Default identity (not set yet)." : `Set by ${stored.updatedBy ?? "an admin"}${stored.updatedAt === undefined ? "" : ` on ${new Date(stored.updatedAt).toLocaleString()}`}.`}
          </p>
          <Button size="small" variant="solid" disabled={busy || !changed || invalid.length > 0} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
