import { ArrowRight, BookOpenText, Check, CircleAlert, Copy, ExternalLink, GitPullRequest, ShieldCheck, Terminal, Workflow as WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";

const SECTIONS = [
  { id: "start", label: "Get started" },
  { id: "flow", label: "How it works" },
  { id: "commands", label: "CLI commands" },
  { id: "access", label: "Access & support" },
] as const;

const FLOW = `sequenceDiagram
  actor Developer
  participant Portal as Kintsugi portal
  participant CLI as Local Kintsugi CLI
  participant Files as Personal plugin files
  participant AI as Codex Desktop
  participant Browser
  participant GitHub as GitHub or GHES
  Developer->>Portal: Copy project-specific prepare command
  Developer->>CLI: Prepare Codex Desktop package (no sign-in)
  CLI->>Files: Write ~/.codex/plugins package
  CLI->>Files: Merge ~/.agents/plugins/marketplace.json
  Developer->>AI: Restart, open Plugins Directory, install Kintsugi plugin
  Developer->>AI: Start a new local chat and ask about Kintsugi work
  AI->>CLI: First MCP request
  CLI->>Browser: Open Kintsugi sign-in (PKCE)
  Browser->>Portal: Sign in and approve the named project
  Portal-->>Browser: Return one-use code and state to loopback
  CLI->>Portal: Exchange code and verifier
  Portal-->>CLI: 5-minute access + rotating refresh credential
  Note over CLI: Access stays in memory, and refresh stays in OS keyring
  AI->>CLI: Request task brief, documents, status or review
  CLI->>Portal: Project-scoped read request over HTTPS
  Portal-->>CLI: Snapshot context, citations and current findings
  CLI-->>AI: MCP tool results
  AI-->>Developer: Explain the task and proposed work
  Developer->>AI: Implement in the code repository
  AI->>GitHub: Open or update a pull request with normal GitHub access
  GitHub-->>Portal: Webhook and scheduled reconciliation
  AI->>CLI: Read findings or watch task events
  CLI->>Portal: Review lookup or resumable SSE subscription
  Portal-->>AI: Current findings and workflow updates
  Note over Developer,GitHub: Kintsugi MCP is read-only. The AI client uses its normal repository access.`;

const OFFICIAL_LINKS = [
  { label: "Node.js", href: "https://nodejs.org/en/download", note: "22.19 or newer" },
  { label: "Git", href: "https://git-scm.com/downloads", note: "required for repositories" },
  { label: "Codex Desktop plugins", href: "https://developers.openai.com/plugins/build/plugins", note: "local marketplace guide" },
  { label: "Claude Code", href: "https://code.claude.com/docs/en/setup", note: "separate CLI setup" },
] as const;

function portalOrigin(): string {
  return typeof window === "undefined" ? "https://kintsugi.example" : window.location.origin;
}

function ExternalDocLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{children}<ExternalLink className="size-3" /></a>;
}

function Command({ label, value }: { label?: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-w-0 rounded-md bg-recessed px-3 py-2">
      {label === undefined ? null : <p className="mb-1 text-[11px] text-text-muted">{label}</p>}
      <div className="flex min-w-0 items-start gap-3">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12px] leading-5 text-text">{value}</code>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied command" : "Copy command"} className="inline-flex size-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Step({ number, title, active = false, children }: { number: number; title: string; active?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-recessed font-mono text-[12px] text-text-secondary">{number}</span>
      <div className={`min-w-0 ${active ? "rounded-md pl-3 [box-shadow:inset_2px_0_0_0_var(--ds-accent)]" : ""}`}>
        <h3 className="text-[13px] font-medium text-text">{title}</h3>
        <div className="mt-1.5 space-y-2 text-[12.5px] leading-5 text-text-secondary">{children}</div>
      </div>
    </li>
  );
}

function GetStarted(): React.JSX.Element {
  const installUrl = portalOrigin();

  return (
    <div className="space-y-4">
      <section aria-labelledby="prerequisites-heading" className="rounded-lg bg-recessed/60 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="prerequisites-heading" className="text-[12px] font-semibold text-text">Before you start</h2>
          <p className="text-[11px] text-text-muted">Kintsugi account · project access · Node.js 22.19+ · local repository</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
          {OFFICIAL_LINKS.map((item) => <span key={item.label}><ExternalDocLink href={item.href}>{item.label}</ExternalDocLink><span className="ml-1 text-text-muted">{item.note}</span></span>)}
        </div>
      </section>

      <div className="rounded-lg bg-surface px-4 py-4 shadow-border">
        <ol className="divide-y divide-[var(--ds-background-300)]">
          <Step number={1} title="Install the Kintsugi CLI prerequisite">
            <p>The CLI package is not published yet. For this local preview, build it once from the Kintsugi source repository:</p>
            <Command value="corepack pnpm --filter @kintsugi/cli... build\npnpm kintsugi --help" />
          </Step>
          <Step number={2} title="Prepare the Codex Desktop plugin" active>
            <p>Open the project’s Coding Agent Workflow section and copy its generated command. It already contains this Kintsugi URL and project ID. The command writes a nonsecret profile, stages the plugin under your user account, and adds one entry to the personal marketplace. It does not sign in or install the plugin in the app.</p>
            <Command value={`pnpm kintsugi plugins setup --install-mode desktop-ui --harness codex --url ${installUrl} --project your-project-id`} />
            <Link to="/projects" className="inline-flex items-center gap-1 text-accent hover:underline">Open Projects <ArrowRight className="size-3.5" /></Link>
          </Step>
          <Step number={3} title="Install it in Codex Desktop">
            <p>Restart Codex Desktop so it discovers the local marketplace. Open <strong>Plugins → Plugins Directory</strong>, select the local Kintsugi marketplace, review the Coding Agent Workflow entry, and install it. Then start a new local chat.</p>
            <p>The Codex app installs a copy into its plugin cache. Re-run the prepare command after Kintsugi updates the generated package, then restart the app to load the updated copy.</p>
          </Step>
          <Step number={4} title="Sign in on first use">
            <p>When Codex first requests Kintsugi context, the local CLI bridge opens a browser for project-specific consent. Kintsugi keeps access tokens short-lived and stores the rotating refresh credential in your operating system credential store.</p>
            <p>If the browser cannot open automatically, copy the sign-in link from the terminal into a browser on the same machine. Your administrator’s 15- or 30-day connection policy determines when you sign in again.</p>
          </Step>
          <Step number={5} title="Ask Codex to work on a Kintsugi task">
            <p>Ask in your normal language. For example: “Find my assigned Kintsugi tasks and explain the design and acceptance criteria for <code>app/module/unit</code>.”</p>
            <p>The plugin guides Codex to retrieve cited task context and required standards before it proposes or makes changes. Codex uses your existing repository and GitHub access when creating a pull request.</p>
          </Step>
        </ol>
      </div>
      <p className="flex items-start gap-2 text-[11px] leading-5 text-text-muted"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />This is a local preview workflow. Codex Desktop must run a local conversation to launch the stdio bridge. Hosted chats need a remote MCP connection, which is not part of this setup. Claude Code remains available through its separate native CLI setup.</p>
    </div>
  );
}

function Workflow(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-[12.5px] leading-5 text-text-secondary">The CLI prepares the local plugin and runs as the stdio bridge when Codex asks for Kintsugi context. Codex reads the context, then uses its regular coding tools and GitHub authorization to do the implementation.</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><WorkflowIcon className="size-3.5" />Read path and PR feedback</span>
      </div>
      <div className="rounded-lg bg-surface p-2 shadow-border sm:p-3">
        <MermaidDiagram source={FLOW} title="Developer, AI harness, Kintsugi and GitHub sequence" height={620} />
      </div>
      <div className="grid gap-3 text-[12px] sm:grid-cols-3">
        <div className="border-l-2 border-[var(--ds-background-300)] pl-3"><p className="font-medium text-text">1. Read context</p><p className="mt-1 leading-5 text-text-secondary">Task brief, approved designs, standards and evidence share a pinned snapshot with citations.</p></div>
        <div className="border-l-2 border-[var(--ds-background-300)] pl-3"><p className="font-medium text-text">2. Create a PR</p><p className="mt-1 leading-5 text-text-secondary">You and your AI work in the code repository. The AI client uses your normal GitHub permissions.</p></div>
        <div className="border-l-2 border-[var(--ds-background-300)] pl-3"><p className="font-medium text-text">3. Continue in Kintsugi</p><p className="mt-1 leading-5 text-text-secondary">Kintsugi observes PR changes, records review findings and streams task updates. Human gates remain in Kintsugi.</p></div>
      </div>
    </div>
  );
}

function Commands(): React.JSX.Element {
  const installUrl = portalOrigin();
  const commands = [
    { title: "Prepare Codex Desktop plugin", description: "Copy the project-specific command from the project’s Coding Agent Workflow section. It stages the package; finish installation in Codex Desktop. For this unpublished local preview, run it from the Kintsugi source workspace with `pnpm`.", value: `pnpm kintsugi plugins setup --install-mode desktop-ui --harness codex --url ${installUrl} --project your-project-id` },
    { title: "Find and explain work", description: "Use commands directly or ask your AI to call the same read-only MCP tools.", value: "pnpm kintsugi task list --mine --profile work\npnpm kintsugi task brief app/module/unit --profile work\npnpm kintsugi task status app/module/unit --profile work" },
    { title: "Review progress", description: "Read current findings or follow resumable task events while you work.", value: "pnpm kintsugi review list --task app/module/unit --profile work\npnpm kintsugi task watch app/module/unit --profile work" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-recessed/60 px-3 py-2.5 text-[12px] leading-5 text-text-secondary"><Terminal className="mt-0.5 size-4 shrink-0 text-text-muted" /><p><strong className="text-text">Short command:</strong> <code>pnpm kintsugi</code> works from the Kintsugi source repository after the CLI build. After a published install, use <code>kintsugi</code> directly.</p></div>
      {commands.map((item) => <section key={item.title} className="border-b border-[var(--ds-background-300)] pb-4 last:border-0 last:pb-0"><h2 className="text-[13px] font-medium text-text">{item.title}</h2><p className="mb-2 mt-1 text-[12px] text-text-secondary">{item.description}</p><Command value={item.value} /></section>)}
      <p className="text-[11px] leading-5 text-text-muted">Replace <code>app/module/unit</code> with the full task unit ID shown in Kintsugi. Run <code>pnpm kintsugi --help</code> for options.</p>
    </div>
  );
}

function AccessAndSupport(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <section aria-labelledby="access-heading">
        <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-text-muted" /><h2 id="access-heading" className="text-[14px] font-medium text-text">What the connection can access</h2></div>
        <dl className="mt-3 divide-y divide-[var(--ds-background-300)] rounded-lg bg-surface px-3 shadow-border">
          <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]"><dt className="text-[12px] font-medium text-text">Kintsugi access</dt><dd className="text-[12px] leading-5 text-text-secondary">Permission and Project Access are checked for every request. Five-minute access tokens stay in memory; the rotating refresh credential stays in the OS credential store.</dd></div>
          <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]"><dt className="text-[12px] font-medium text-text">MCP tools</dt><dd className="text-[12px] leading-5 text-text-secondary">Read task context, documents, status, reviews and events. They cannot edit or claim tasks, approve gates, merge PRs or write to repositories.</dd></div>
          <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]"><dt className="text-[12px] font-medium text-text">Repository access</dt><dd className="text-[12px] leading-5 text-text-secondary">Your AI harness uses its normal GitHub access to commit and open a PR. Kintsugi's provider connection separately observes PRs and reviews.</dd></div>
          <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]"><dt className="text-[12px] font-medium text-text">Model and hooks</dt><dd className="text-[12px] leading-5 text-text-secondary">Use the model subscription already attached to your AI client. The Kintsugi plugin adds no hooks and does not inject prompts into an existing chat.</dd></div>
          <div className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]"><dt className="text-[12px] font-medium text-text">Linux credential setup</dt><dd className="text-[12px] leading-5 text-text-secondary">Install <code>secret-tool</code> and configure a Secret Service provider such as GNOME Keyring or KWallet before signing in.</dd></div>
        </dl>
      </section>

      <section aria-labelledby="readiness-heading">
        <h2 id="readiness-heading" className="text-[14px] font-medium text-text">Current preview checks</h2>
        <ul className="mt-2 space-y-2 text-[12px] leading-5 text-text-secondary">
          <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-green)]" /><span>Automated package, OAuth, and local stdio checks cover profile scoping, refresh, revocation, and read-only MCP responses.</span></li>
          <li className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-orange)]" /><span>The Codex Desktop personal-marketplace package is covered by local tests; installing it in the app and completing an authenticated MCP call still need a real-client pilot.</span></li>
          <li className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-orange)]" /><span>Claude Code, GitHub.com provider flows, and end-to-end PR observation still need authenticated pilots.</span></li>
          <li className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-orange)]" /><span>GitHub.com provider flows need an authenticated pilot; GitHub Enterprise Server and Copilot CLI are not yet validated.</span></li>
        </ul>
      </section>
      <p className="text-[11px] text-text-muted">GitLab, Bitbucket and other providers are future integrations. The current workflow targets GitHub first.</p>
    </div>
  );
}

export function DeveloperDocumentsPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={["Workspace", "Developer docs"]} />
      <PageHeading
        title="Developer documents"
        description="Methodology, workflows and practical instructions for building with Kintsugi."
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:border-r lg:border-[var(--ds-background-300)] lg:pr-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[12px] font-medium text-text">Guides</h2>
            <span className="text-[11px] text-text-muted">1 available</span>
          </div>
          <nav aria-label="Developer guides" className="flex flex-col gap-1">
            <a
              href="#coding-agent-workflow"
              aria-current="page"
              className="flex min-h-9 items-center gap-2 rounded-md bg-recessed px-2.5 py-2 text-[12px] font-medium text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
            >
              <BookOpenText className="size-4 shrink-0 text-accent" />
              <span>Coding Agent Workflow</span>
            </a>
          </nav>
        </aside>

        <article id="coding-agent-workflow" className="min-w-0 scroll-mt-5">
          <header className="border-b border-[var(--ds-background-300)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Guide 01</p>
                <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-text">Coding Agent Workflow</h2>
                <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-text-secondary">
                  Connect your chosen AI to Kintsugi context, work in your repository, then follow the pull request and task progress here.
                </p>
              </div>
              <span className="rounded-full bg-recessed px-2.5 py-1 text-[11px] text-text-secondary">Local preview</span>
            </div>

            <nav aria-label="In this guide" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 pb-3 text-[12px]">
              <span className="font-medium text-text-muted">On this page</span>
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={"#" + section.id}
                  className="text-text-secondary hover:text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </header>

          <div className="divide-y divide-[var(--ds-background-300)]">
            {SECTIONS.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={"guide-heading-" + section.id}
                className="scroll-mt-5 py-6 first:pt-5 last:pb-0"
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-text-muted">{String(index + 1).padStart(2, "0")}</span>
                  <h3 id={"guide-heading-" + section.id} className="text-[14px] font-medium text-text">{section.label}</h3>
                  {section.id === "flow" ? (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                      <GitPullRequest className="size-3.5" />Task to pull request
                    </span>
                  ) : null}
                </div>
                {section.id === "start" ? <GetStarted /> : section.id === "flow" ? <Workflow /> : section.id === "commands" ? <Commands /> : <AccessAndSupport />}
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
