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
  /** Whether the installation has a CLI release: false when it has none, undefined until known. */
  released: boolean | undefined;
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

/** Said instead of the install commands when the installation has no CLI release to install. */
function NoRelease(): React.JSX.Element {
  return (
    <Callout>
      This installation has no CLI release yet; an administrator builds it with <Code>pnpm release:cli</Code>.
    </Callout>
  );
}

/** The one-line installers, or a notice when there is no release they could install. */
function InstallCommands({ context }: { context: GuideContext }): React.JSX.Element {
  if (context.released === false) return <NoRelease />;
  return <CodeTabs label="Install the CLI" tabs={installTabs(context)} />;
}

/** The packages of the latest release with their SHA-256, for a manual install. */
function PackageList({ context }: { context: GuideContext }): React.JSX.Element {
  if (context.released === false) return <NoRelease />;
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
  summary: "Install the CLI, sign in, set up your AI clients and install your first plugin in about ten minutes.",
  render: (context) => (
    <>
      <P>The Kintsugi CLI connects the AI client you already use (Claude Code, Codex, GitHub Copilot) to your project in Kintsugi. Your AI can read the project&apos;s documents, install the plugins your project offers, and record what they did. Kintsugi never drives your AI and never gets write access to your repositories.</P>
      <div className="mt-2">
        <Step number={1} eyebrow="~3 min · install" title="Install the Kintsugi CLI">
          <P>One command, no administrator rights. It needs Node.js {context.minNode} or newer, which the installer checks.</P>
          <InstallCommands context={context} />
          <Callout>Windows or running into errors? <Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/install-the-cli">Full installation guide →</Link></Callout>
        </Step>
        <Step number={2} eyebrow="~3 min · sign in and set up" title="Sign in, then set up your AI clients">
          <P>Sign in to your project in the browser. Then <Code>init</Code> lists the AI clients it finds on your machine (Claude Code, Codex), asks which to set up, and whether for all your workspaces or only the current one. The installer already told the CLI which Kintsugi to talk to.</P>
          <CodeBlock label="Sign in and set up" code={"kintsugi login my-project\nkintsugi init"} />
          <P>Restart the client. Nothing else to configure: the connection is ready.</P>
        </Step>
        <Step number={3} eyebrow="~2 min · plugins" title="Install a plugin into all of them">
          <P>Plugins are the flows your project offers to its members. See what you may install, then install one into every client you set up.</P>
          <CodeBlock label="Install a plugin" code={"# What does my project offer?\nkintsugi plugins list\n\n# Install it into every client you set up\nkintsugi install plugin modernize --all\n\n# Later: bring it up to date\nkintsugi install fetch modernize"} />
          <H3>Use it in your AI tool</H3>
          <P>Start a new session in Claude Code or Codex. A plugin command is named after the plugin: for example <Code>/modernize:build billing/invoice my-project</Code> builds a unit (see <Link className="text-[var(--ds-accent)] hover:underline" to="/guideline/build-a-unit">Build a unit</Link>).</P>
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
      <InstallCommands context={context} />
      <P>The installer downloads the package for your platform from this installation, checks it against a SHA-256 that came with the installer, and unpacks it into <Code>~/.kintsugi</Code> (<Code>%LOCALAPPDATA%\Kintsugi</Code> on Windows). It changes nothing else, except that on Windows it adds its <Code>bin</Code> folder to your user PATH. On macOS and Linux it prints the line to add to your shell profile instead of editing it.</P>
      <CodeBlock label="Verify" code={"# Open a new terminal, then:\nkintsugi --version"} />
      <H2>Manual download</H2>
      <PackageList context={context} />
      <H2>Update</H2>
      <P>Run the same installer again. It replaces the CLI in place, so the plugins you generated for your AI client keep working. Set <Code>KINTSUGI_HOME</Code> before running it to install somewhere else.</P>
      <H2>Remove</H2>
      <CodeBlock label="Remove" code={"# Remove the plugins from your AI client first\nkintsugi remove modernize --all\n\n# Then delete the folder\nrm -rf ~/.kintsugi"} />
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
  title: "Set up your AI clients",
  group: "CLI and plugins",
  summary: "What init does, where it installs, how sign-in works and how to disconnect.",
  render: () => (
    <>
      <P>A connection links your AI clients to one project. It is made of a small Kintsugi package in each client (it starts a local program that talks to Kintsugi), and your sign-in, which is separate and revocable.</P>
      <H2>Sign in, then init</H2>
      <CodeBlock label="Set up" code={"kintsugi login my-project\nkintsugi init"} />
      <P><Code>init</Code> finds the clients on your machine and asks two things: <strong>which clients</strong> to set up, and whether to install <strong>globally</strong> (every workspace) or only for <strong>the current workspace</strong>. It then installs the Kintsugi connector in each. Skip the questions with flags:</P>
      <CodeBlock label="Without questions" code={"# Every client found, for all workspaces\nkintsugi init --all\n\n# Claude Code only, for this folder only\nkintsugi init -H claude --scope workspace"} />
      <Table
        head={["Client", "Set up by init", "Notes"]}
        rows={[
          ["Claude Code", "yes", "Global, or this workspace (it installs for you only, not for your teammates)."],
          ["Codex CLI", "yes", "Global only. A plugin's command arrives as a skill (run it with $ or /skills); Codex has no agents. Codex asks you to trust the Kintsugi reporting hook once: /hooks."],
          ["GitHub Copilot CLI", "yes", "Global only. A plugin's command arrives as a skill, run as /plugin:skill."],
          ["Codex Desktop", "yes", "Prepares a local marketplace; restart the app and install Kintsugi from Plugins → Plugins Directory."],
          ["ChatGPT", "not yet", "Not supported yet."],
        ]}
      />
      <P>Add <Code>--url https://…</Code> if your CLI was not installed from this installation, and <Code>--verbose</Code> to see the files written and the client commands run. A client version other than the one tested is used with a note, not refused.</P>
      <P><Code>kintsugi connect &lt;client&gt; [project]</Code> is the short form for one client.</P>
      <H2>Sign in</H2>
      <P>The browser opens, you sign in, review the project and approve it; no token is created or pasted. Kintsugi issues a five-minute access token that stays in memory, and a rotating refresh credential that is kept in your operating system credential store. An administrator sets how long a connection may live (15 or 30 days) before you approve again.</P>
      <CodeBlock label="Sign in and out" code={"# Who am I connected as?\nkintsugi auth status\n\n# Sign out and revoke this connection at Kintsugi\nkintsugi auth logout"} />
      <H2>See and revoke connections</H2>
      <P>Open your project in the portal, tab <strong>Connect your AI</strong>: every connection is listed with when it was made, and you can revoke it. A revoked connection stops working on its next request.</P>
    </>
  ),
};

const plugins: GuidePage = {
  slug: "member-plugins",
  title: "Member plugins",
  group: "CLI and plugins",
  summary: "List, install, update and remove the plugins your project offers.",
  render: () => (
    <>
      <P>A member plugin is a flow for your own AI client, written as skills, agents and commands that your AI reads. Your project&apos;s administrators decide which plugins you may use.</P>
      <CodeBlock label="Plugins" code={"# What may I install, and what is installed?\nkintsugi plugins list\n\n# Install it into every client you set up with init\nkintsugi install plugin modernize --all\n\n# Bring installed plugins up to date (one, or all when no name)\nkintsugi install fetch modernize\n\n# Remove it\nkintsugi remove modernize --all"} />
      <H2>Which client?</H2>
      <P><Code>--all</Code> means every client you set up with <Code>init</Code>. Without it, one client is used; with several set up, <Code>kintsugi</Code> asks (or pass <Code>-H claude</Code>, <Code>-H codex</Code> or <Code>-H copilot</Code>). Plugins follow the scope you chose in <Code>init</Code>: a workspace install must be run from that workspace.</P>
      <H2>What gets installed</H2>
      <List>
        <li>Each plugin is a plugin of its own in your client, named after itself, so its commands read <Code>/modernize:build</Code>.</li>
        <li>Only text: skills, agents and commands. Claude Code receives all three; Codex and Copilot receive a command as a skill, and Codex no agents.</li>
        <li>No scripts and no hook files come with a plugin. The one thing that may run is the <em>activity hook</em> a command declares, which only reports to your project&apos;s monitoring (see Record activity).</li>
        <li>Every file is checked against its SHA-256, and the whole plugin against a content hash, before anything is written. If a check fails nothing is changed.</li>
        <li>The files go into the Kintsugi package of your client, not into the client&apos;s own settings. An update deletes the files the new version dropped; <Code>remove</Code> deletes the plugin&apos;s folder.</li>
      </List>
      <P>Start a new client session after installing, updating or removing a plugin.</P>
    </>
  ),
};

const build: GuidePage = {
  slug: "build-a-unit",
  title: "Build a unit",
  group: "CLI and plugins",
  summary: "Implement and test a designed unit on your machine; the runtime reviews your merge request.",
  render: (context) => (
    <>
      <P>
        Once a unit&apos;s design is merged, <strong>you</strong> build it: the code and its unit tests are written on your machine, in the target repository, by your own AI client. Kintsugi does not implement or test. It collects <strong>which unit you built in which merge request</strong>,
        and its runtime reads that merge request as an independent reviewer. (Proving the merged unit builds and passes from clean comes later.)
      </P>
      <div className="mt-2">
        <Step number={1} eyebrow="plugin" title="Get the plugin">
          <P>An administrator offers <Code>modernize</Code> to you in the project (Project → Member plugins). Then, once:</P>
          <CodeBlock label="Install the plugin" code={"kintsugi login my-project\nkintsugi init\nkintsugi install plugin modernize --all"} />
        </Step>
        <Step number={2} eyebrow="repository" title="Open the target repository in your AI client">
          <P>Start a new session in the repository the unit is built in, with the project connected.</P>
        </Step>
        <Step number={3} eyebrow="command" title="Run the command for a unit">
          <CodeBlock label="Build a unit" code={"# Claude Code and GitHub Copilot\n/modernize:build billing/invoice my-project\n\n# Codex\n$build billing/invoice my-project"} />
          <P>The unit is <Code>&lt;module&gt;/&lt;unit&gt;</Code>. The Build page of the portal shows the same commands for each unit.</P>
        </Step>
        <Step number={4} eyebrow="build" title="Approve the plan, then let it build">
          <P>It reads the unit&apos;s rules, merged design and the standards through the Kintsugi tools, plans the files and waits for your yes. Then it writes the code, tests every rule with tests that name it, counts the cases that ran and breaks the code once on purpose (the <em>canary</em>) to show the tests can fail.</P>
        </Step>
        <Step number={5} eyebrow="merge request" title="Open the merge request and let it record">
          <P>You commit and open the merge request. The command then records the unit, the merge request, its branch and head commit and the numbers of your test run, so the runtime can review it. Pushed more commits after a review? Run the command again so it records the new commit.</P>
        </Step>
      </div>
      <H2>What is reported while you build</H2>
      <P>You do nothing for this: the command carries a hook that runs when each of its turns ends. Kintsugi receives, through the CLI, numbers and names only:</P>
      <Table
        head={["When", "Record", "What it holds"]}
        rows={[
          ["After each turn of the command", <Code key="1">command.run</Code>, "Who ran it, the plugin and command, the model, input and output tokens (and cache), turns, and how long it took so far. Read from your client's session file on your machine; nothing you or the AI wrote is sent."],
          ["Tests have run", <Code key="2">build.test</Code>, "The unit, cases executed, failed, and whether the canary was caught."],
          ["The merge request is open", <Code key="3">build.mr</Code>, "The unit, the merge request URL, branch and head commit, plus the same counts."],
        ]}
      />
      <P>Administrators see these per member in Monitoring → Members; the Build page uses <Code>build.mr</Code> to know which merge request to review.</P>
      <H2>What the runtime does</H2>
      <P>
        On the Build page, <strong>Review on the portal</strong> sends a merge request to the runtime. A reviewer who did not write the code reads it against the rules and design of each unit — fidelity, tests, hidden failures, design, security — and a pull request on the document repository
        carries one <Code>review.md</Code> per unit with the findings. It cannot run your code and it changes nothing in your merge request: you fix the findings, push, and ask again.
      </P>
      <H2>What Kintsugi keeps</H2>
      <List>
        <li>Only counts and links: the unit, the merge request URL, branch and commit, cases run and failed, the canary result. Never code or document content.</li>
        <li>You see the merge request and numbers next to the unit on the Build page ({context.baseUrl}/delivery/build); administrators also see them per member in Monitoring → Members.</li>
      </List>
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
      <CodeBlock label="Record" code={'kintsugi activity record result \\\n  --plugin modernize \\\n  --summary "Reviewed the coding standards" \\\n  --detail documents=3'} />
      <P>Plugins do this for you through the <Code>activity_record</Code> tool; you rarely type it yourself.</P>
      <H2>Limits</H2>
      <List>
        <li>A kind such as <Code>result</Code>, <Code>note</Code> or <Code>run</Code>. Kinds starting with <Code>plugin.</Code> or <Code>document.</Code> are Kintsugi&apos;s own.</li>
        <li>A summary of at most 500 characters and up to 20 scalar details. Never put document content, credentials or personal data in them.</li>
        <li>The plugin must be one you may use in the project. At most 600 notes an hour per member. The note is sent once and never retried.</li>
      </List>
      <H2>The activity hook of a command</H2>
      <P>A plugin command can declare one hook that runs <Code>kintsugi activity hook</Code> when its turn ends. It reads the session file your AI client keeps on your machine, counts what the command used (tokens, turns, time) and sends that as a <Code>command.run</Code> note. It sends numbers and names only, uses your own sign-in, and never stops your session if it cannot report. Kintsugi refuses to distribute a plugin whose hook runs anything else.</P>
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
          [<Code key="1">kintsugi login &lt;project&gt;</Code>, "Sign in in the browser. Also: auth login, auth status, auth logout."],
          [<Code key="2">kintsugi init [project]</Code>, "Find your AI clients, choose which to set up and global or this workspace. Flags: -H, --all, --scope, --yes."],
          [<Code key="3">kintsugi plugins list</Code>, "Plugins you may install, and where they are installed."],
          [<Code key="4">kintsugi install plugin &lt;plugin&gt; [--all | -H client]</Code>, "Install a plugin into the clients you set up. Short form: add."],
          [<Code key="5">kintsugi install fetch [plugin]</Code>, "Bring an installed plugin (or all) up to date."],
          [<Code key="5b">kintsugi remove &lt;plugin&gt; [--all | -H client]</Code>, "Remove a member plugin."],
          [<Code key="5c">kintsugi connect &lt;client&gt; [project]</Code>, "Set up one client (the short form of init -H)."],
          [<Code key="6">kintsugi project list | use &lt;id&gt;</Code>, "List your projects; choose the default one."],
          [<Code key="7">kintsugi document tree [path]</Code>, "List a folder of the project's document repository."],
          [<Code key="8">kintsugi document get &lt;path&gt;</Code>, "Read a Markdown file of the document repository."],
          [<Code key="9">kintsugi activity record &lt;kind&gt;</Code>, "Record a short note for the project's monitoring. activity hook is run by plugin commands."],
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

export const GUIDE_PAGES: GuidePage[] = [overview, install, connect, plugins, build, record, reference, admin];
export const GUIDE_GROUPS: GuidePage["group"][] = ["Get started", "CLI and plugins", "For administrators"];
