// Login — local username/password sign-in (ADR-0008). Dev default: admin / admin@1234.

import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { BrandMark } from "../components/brand-mark";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { useAuth } from "../lib/auth";
import { safeCodingAgentReturnTo } from "./agent-context/coding-agent-install-model";

export function LoginPage(): React.JSX.Element {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeCodingAgentReturnTo(searchParams.get("returnTo"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user !== null) return <Navigate to={returnTo} replace />;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate(returnTo, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-9" />
            <div>
              <CardTitle className="text-[16px]">Sign in to Kintsugi</CardTitle>
              <CardDescription>Migration &amp; modernization portal</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Username">
              <Input value={username} autoComplete="username" placeholder="Username" onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} autoComplete="current-password" placeholder="Password" onChange={(event) => setPassword(event.target.value)} />
            </Field>
            {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
            <Button type="submit" variant="solid" disabled={submitting || username === "" || password === ""}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
