/* eslint-disable react-refresh/only-export-components -- page data and the components it renders live together */
// The pages of the Guideline (/guideline). Commands carry this installation's own URL; everything stated here is
// what the CLI and the installation do today (docs/reference/member-cli.md has the long form).

import { Monitor, Package, Terminal } from "lucide-react";
import { Link } from "react-router-dom";
import { type ReleaseAsset, platformName } from "@/lib/release-format";
import { Callout, Code, CodeBlock, CodeTabs, H2, H3, List, P, Step, Table } from "./guideline-parts";

export interface GuideContext {
  /** The installation's URL. */
  baseUrl: string;
  /** Lowest Node.js version the CLI runs on. */
  minNode: string;
  /** The latest release, when this installation has one. */
  version: string | undefined;
  assets: ReleaseAsset[];
}

export interface GuidePage {
  slug: string;
  title: string;
  group: "Get started" | "CLI and plugins" | "For administrators";
  summary: string;
  render: (context: GuideContext) => React.JSX.Element;
}

export const DEFAULT_GUIDE = "overview-getting-started";

function installTabs(context: GuideContext): Array<{ id: string; label: string; icon: React.JSX.Element; code: string }> {
  const base = `${context.baseUrl}/api/v1/releases/latest`;
  return [
    { id: "sh", label: "macOS / Linux", icon: <Terminal className="size-4" />, code: `curl -fsSL ${base}/install.sh | sh` },
    { id: "ps1", label: "Windows (PowerShell)", icon: <Monitor className="size-4" />, code: `powershell -ExecutionPolicy Bypass -Command "irm ${base}/install.ps1 | iex"` },
    { id: "manual", label: "Manual (any OS)", icon: <Package className="size-4" />, code: "# Download the package for your platform from the list on the Install the CLI page\n# Unpack it, add its bin folder to PATH, then verify:\nkintsugi --version" },
  ];
}

/** The packages of the latest release with their SHA-256, for a manual install. */
function PackageList({ context }: { context: GuideContext }): React.JSX.Element {
  if (context.assets.length === 0) return <P>This installation has no CLI release yet; an administrator builds it with the image.</P>;
  return (
    <>
      <P>Version {context.version}. Download the package for your platform, check its SHA-256, unpack it, and put its <Code>bin</Code> folder on your PATH.</P>
      <Table
        head={["Platform", "Package", "SHA-256"]}
        rows={context.assets.map((asset) => [
          platformName(asset.platform),
          <a key={asset.file} className="text-[var(--ds-accent)] hover:underline" href={asset.url} download>{asset.file}</a>,
          <code key="hash" className="font-mono text-[11px] break-all">{asset.sha256}</code>,
        ])}
      />
    </>
  );
}

const overview: GuidePage = {
  slug: "overview-getting-started",
  title: "Quick start",
  group: "Get started",
  summary: "Install the CLI, connect your AI client and add your first plugin in about ten minutes.",
  render: (context) => (
    <>
      <P>The Kintsugi CLI connects the AI client you already use (Claude Code, Codex) to your project in Kintsugi. Your AI can read the project&apos;s documents, install the plugins your project offers, and record what they did. Kintsugi never drives your AI and never gets write access to your repositories.</P>
      <div className="mt-2">
        <Step number={1} eyebrow="~3 min · install" title="Install the Kintsugi CLI">
          <P>One command, no administrator rights. It needs Node.js {context.minNode} or newer, which the installer checks.</P>
          <CodeTabs label="Install the CLI" tabs={installTabs(context)} />
          <Callout>Windows or running into errors? <Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/install-the-cli">Full installation guide →</Link></Callout>
        </Step>
        <Step number={2} eyebrow="~3 min · connect" title="Connect your AI client to a project">
          <P>Choose the client (<Code>claude</Code>, <Code>codex</Code> or <Code>codex-desktop</Code>) and the project. The installer already told the CLI which Kintsugi to talk to.</P>
          <CodeBlock label="Connect" code={"# Connect Claude Code to the project my-project\nkintsugi connect claude my-project\n\n# Optional: sign in now (otherwise your AI opens the browser on first use)\nkintsugi login my-project"} />
          <P>Restart the client. The first time it needs Kintsugi, your browser opens so you can sign in and approve the project.</P>
        </Step>
        <Step number={3} eyebrow="~2 min · plugins" title="Add your first plugin">
          <P>Plugins are the flows your project offers to its members. See what you may install, then add one.</P>
          <CodeBlock label="Add a plugin" code={"# What does my project offer?\nkintsugi plugins list\n\n# Add one — for example, the project context plugin\nkintsugi add context"} />
          <H3>Use it in your AI tool</H3>
          <P>Start a new session in Claude Code or Codex and ask a question about the project, for example <Code>Using Kintsugi, summarize our coding standards</Code>. The plugin reads the documents through Kintsugi and answers with citations.</P>
        </Step>
      </div>
      <H2>What to read next</H2>
      <List>
        <li><Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/member-plugins">Member plugins</Link>: install, update and remove.</li>
        <li><Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/record-activity">Record activity</Link>: what a plugin can write back, and what administrators see.</li>
        <li><Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/cli-reference">CLI reference</Link>: every command on one page.</li>
      </List>
    </>
  ),
};

const install: GuidePage = {
  slug: "install-the-cli",
  title: "Install the CLI",
  group: "Get started",
  summary: "Requirements, the installers, updating, removing and fixing common errors.",
  render: (context) => (
    <>
      <H2>Requirements</H2>
      <List>
        <li>Node.js {context.minNode} or newer on your PATH. The CLI is one JavaScript file and runs on the Node.js you have.</li>
        <li>macOS (Intel or Apple silicon), Linux (x64 or ARM64) or Windows 10 and later (x64 or ARM64).</li>
        <li>Linux stores your sign-in in the Secret Service: install <Code>libsecret-tools</Code> and a keyring such as GNOME Keyring. macOS and Windows use their own credential stores.</li>
      </List>
      <H2>Install</H2>
      <CodeTabs label="Install the CLI" tabs={installTabs(context)} />
      <P>The installer downloads the package for your platform from this installation, checks it against a SHA-256 that came with the installer, and unpacks it into <Code>~/.kintsugi</Code> (<Code>%LOCALAPPDATA%\Kintsugi</Code> on Windows). It changes nothing else, except that on Windows it adds its <Code>bin</Code> folder to your user PATH. On macOS and Linux it prints the line to add to your shell profile instead of editing it.</P>
      <CodeBlock label="Verify" code={"# Open a new terminal, then:\nkintsugi --version"} />
      <H2>Manual download</H2>
      <PackageList context={context} />
      <H2>Update</H2>
      <P>Run the same installer again. It replaces the CLI in place, so the plugins you generated for your AI client keep working. Set <Code>KINTSUGI_HOME</Code> before running it to install somewhere else.</P>
      <H2>Remove</H2>
      <CodeBlock label="Remove" code={"# Remove the plugins from your AI client first\nkintsugi remove context\n\n# Then delete the folder\nrm -rf ~/.kintsugi"} />
      <P>On Windows, delete <Code>%LOCALAPPDATA%\Kintsugi</Code> and remove its <Code>bin</Code> folder from your user PATH.</P>
      <H2>Troubleshooting</H2>
      <Table
        head={["You see", "What to do"]}
        rows={[
          [<Code key="a">Node.js … or newer is required</Code>, "Install or update Node.js from nodejs.org, open a new terminal and run the installer again."],
          [<Code key="b">does not match its checksum</Code>, "Nothing was installed. Retry; if you are behind a proxy that rewrites downloads, use the manual package listed on this page."],
          [<Code key="c">kintsugi: command not found</Code>, "Open a new terminal. On macOS and Linux add the printed export line to your shell profile."],
          [<Code key="d">unsupported operating system</Code>, "Use the Windows (PowerShell) installer on Windows; Git Bash and MSYS are not supported. In WSL use the Linux installer."],
          [<Code key="e">Secret Service operation failed</Code>, "Install libsecret-tools and start a keyring (GNOME Keyring or KWallet), then sign in again."],
        ]}
      />
    </>
  ),
};

const connect: GuidePage = {
  slug: "connect-your-ai-client",
  title: "Connect your AI client",
  group: "CLI and plugins",
  summary: "What connect does, how sign-in works and how to disconnect.",
  render: () => (
    <>
      <P>A connection links one AI client to one project. It is made of a small Kintsugi package in your client (it starts a local program that talks to Kintsugi), and your sign-in, which is separate and revocable.</P>
      <H2>Connect</H2>
      <CodeBlock label="Connect" code={"kintsugi connect claude my-project\nkintsugi connect codex my-project\nkintsugi connect codex-desktop my-project"} />
      <Table
        head={["Client", "Command", "Notes"]}
        rows={[
          ["Claude Code", <Code key="a">connect claude</Code>, "Runs the claude plugin commands for you."],
          ["Codex CLI", <Code key="b">connect codex</Code>, "Runs the codex plugin commands for you."],
          ["Codex Desktop", <Code key="c">connect codex-desktop</Code>, "Prepares a local marketplace; restart the app and install Kintsugi from Plugins → Plugins Directory."],
        ]}
      />
      <P>Add <Code>--url https://…</Code> if your CLI was not installed from this installation, and <Code>--verbose</Code> to see the files written and the client commands run. The setup checks the exact client version and stops with a clear message if it is not a tested one.</P>
      <H2>Sign in</H2>
      <P>The first time your AI needs Kintsugi, your browser opens. You sign in, review the project and approve it; no token is created or pasted. Kintsugi issues a five-minute access token that stays in memory, and a rotating refresh credential that is kept in your operating system credential store. An administrator sets how long a connection may live (15 or 30 days) before you approve again.</P>
      <CodeBlock label="Sign in and out" code={"# Sign in now instead of on first use\nkintsugi login my-project\n\n# Who am I connected as?\nkintsugi auth status\n\n# Sign out and revoke this connection at Kintsugi\nkintsugi auth logout"} />
      <H2>See and revoke connections</H2>
      <P>Open your project in the portal, tab <strong>Connect your AI</strong>: every connection is listed with when it was made, and you can revoke it. A revoked connection stops working on its next request.</P>
    </>
  ),
};

const plugins: GuidePage = {
  slug: "member-plugins",
  title: "Member plugins",
  group: "CLI and plugins",
  summary: "List, add, update and remove the plugins your project offers.",
  render: () => (
    <>
      <P>A member plugin is a flow for your own AI client, written as skills, agents and commands that your AI reads. Your project&apos;s administrators decide which plugins you may use.</P>
      <CodeBlock label="Plugins" code={"# What may I install, and what is installed?\nkintsugi plugins list\n\n# Install or update one\nkintsugi add context\n\n# Remove it\nkintsugi remove context"} />
      <H2>Which client?</H2>
      <P>When you connected one client, the commands use it. If you connected both, say which: <Code>kintsugi add context -H claude</Code> or <Code>-H codex</Code>.</P>
      <H2>What gets installed</H2>
      <List>
        <li>Only text: skills, agents and commands. Claude Code receives all three; Codex receives skills.</li>
        <li>Never anything that runs code: no hooks, scripts or workflows come with a plugin.</li>
        <li>Every file is checked against its SHA-256, and the whole plugin against a content hash, before anything is written. If a check fails nothing is changed.</li>
        <li>The files go into the Kintsugi package of your client, not into the client&apos;s own settings, and a record keeps which plugin owns which file. An update deletes the files the new version dropped; <Code>remove</Code> deletes exactly the plugin&apos;s files.</li>
      </List>
      <P>Start a new client session after adding or removing a plugin.</P>
      <H2>Built-in: context</H2>
      <P>The <Code>context</Code> plugin lets your AI find and read the project&apos;s documents (standards, architecture, transition) through Kintsugi, answer with citations, and record a short note of what it did.</P>
    </>
  ),
};

const record: GuidePage = {
  slug: "record-activity",
  title: "Record activity",
  group: "CLI and plugins",
  summary: "The one thing a plugin can write back, and what Kintsugi records on its own.",
  render: () => (
    <>
      <P>Reading projects and documents is read-only. The one write is a short, factual note about work a plugin helped with. It appears in the project&apos;s monitoring and changes no project, document or repository.</P>
      <CodeBlock label="Record" code={'kintsugi activity record result \\\n  --plugin context \\\n  --summary "Reviewed the coding standards" \\\n  --detail documents=3'} />
      <P>Plugins do this for you through the <Code>activity_record</Code> tool; you rarely type it yourself.</P>
      <H2>Limits</H2>
      <List>
        <li>A kind such as <Code>result</Code>, <Code>note</Code> or <Code>run</Code>. Kinds starting with <Code>plugin.</Code> or <Code>document.</Code> are Kintsugi&apos;s own.</li>
        <li>A summary of at most 500 characters and up to 20 scalar details. Never put document content, credentials or personal data in them.</li>
        <li>The plugin must be one you may use in the project. At most 600 notes an hour per member. The note is sent once and never retried.</li>
      </List>
      <H2>What Kintsugi records itself</H2>
      <P>Each plugin download and each document read, with the member, project, plugin and time. Administrators see this per member in <strong>Monitoring → Members</strong>; records are deleted after 30 days by default.</P>
    </>
  ),
};

const reference: GuidePage = {
  slug: "cli-reference",
  title: "CLI reference",
  group: "CLI and plugins",
  summary: "Every command on one page.",
  render: () => (
    <>
      <Table
        head={["Command", "What it does"]}
        rows={[
          [<Code key="1">kintsugi connect &lt;claude|codex|codex-desktop&gt; [project]</Code>, "Connect an AI client to a project."],
          [<Code key="2">kintsugi login [project]</Code>, "Sign in in the browser now. Also: auth login, auth status, auth logout."],
          [<Code key="3">kintsugi plugins list</Code>, "Plugins you may install, and which are installed."],
          [<Code key="4">kintsugi add &lt;plugin&gt; [-H client]</Code>, "Install or update a member plugin."],
          [<Code key="5">kintsugi remove &lt;plugin&gt; [-H client]</Code>, "Remove a member plugin."],
          [<Code key="6">kintsugi project list | use &lt;id&gt;</Code>, "List your projects; choose the default one."],
          [<Code key="7">kintsugi document tree [path]</Code>, "List a folder of the project's document repository."],
          [<Code key="8">kintsugi document get &lt;path&gt;</Code>, "Read a Markdown file of the document repository."],
          [<Code key="9">kintsugi activity record &lt;kind&gt;</Code>, "Record a short note for the project's monitoring."],
          [<Code key="10">kintsugi mcp serve</Code>, "Start the local bridge (your AI client runs this for you)."],
          [<Code key="11">kintsugi doctor</Code>, "Check Node.js, your sign-in and access."],
        ]}
      />
      <H2>Options that work everywhere</H2>
      <List>
        <li><Code>--project &lt;id&gt;</Code> and <Code>--profile &lt;name&gt;</Code> choose the project and the saved connection for one command.</li>
        <li><Code>--json</Code> (or <Code>--format text|json|markdown</Code>) changes the output; results go to stdout, errors to stderr.</li>
        <li><Code>--no-input</Code> never prompts. <Code>--ref</Code> picks a branch or commit for document commands.</li>
        <li><Code>KINTSUGI_URL</Code> and <Code>KINTSUGI_HOME</Code> set the installation and the install folder.</li>
      </List>
    </>
  ),
};

const admin: GuidePage = {
  slug: "offer-plugins",
  title: "Offer plugins to a project",
  group: "For administrators",
  summary: "Who may use which plugin, and how to see what members do with them.",
  render: () => (
    <>
      <P>Open a project in the portal. Its page has tabs for the project itself, its member plugins, its access and its connections.</P>
      <H2>Member plugins</H2>
      <P>Tab <strong>Member plugins</strong> (needs <Code>plugin.access.manage</Code>) lists the plugins meant for members. <strong>Offer to all members</strong> covers everyone with Project Access; <strong>Offer to one member</strong> covers one person. Withdraw a grant at any time; the plugin stays on the member&apos;s machine until they update or remove it, but they can no longer download it.</P>
      <H2>Project access</H2>
      <P>Tab <strong>Project access</strong> (needs <Code>project.access.manage</Code>) grants people explicit access to the project. A member needs it to read the project through the CLI and to receive any plugin.</P>
      <H2>Monitoring</H2>
      <P><strong>Monitoring → Members</strong> (needs <Code>member.activity.view</Code>) shows, per project, each member&apos;s last activity, events by plugin and kind, and the records themselves. Records hold names, counts and short summaries, never document content.</P>
      <H2>Serving the CLI</H2>
      <P>The installation builds the CLI packages with its image and serves them at <Code>/api/v1/releases/latest</Code> with the installers, and lists them under Install the CLI. Nothing needs to be published elsewhere.</P>
    </>
  ),
};

export const GUIDE_PAGES: GuidePage[] = [overview, install, connect, plugins, record, reference, admin];
export const GUIDE_GROUPS: GuidePage["group"][] = ["Get started", "CLI and plugins", "For administrators"];
