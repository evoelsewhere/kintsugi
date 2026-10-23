// Building blocks of the Guideline (/guideline): numbered steps, code blocks with a copy button, tabbed install
// commands, callouts. The guide is plain React so its commands can carry this installation's own URL.

import { Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** A command block: lines starting with # are comments; the button copies the commands without them. */
export function CodeBlock({ code, label }: { code: string; label?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(lines.filter((line) => !line.startsWith("#")).join("\n").replace(/^\n+|\n+$/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="relative rounded-lg border border-black/[0.08] bg-recessed dark:border-white/[0.1]">
      <button
        type="button"
        aria-label={copied ? "Copied" : `Copy ${label ?? "commands"}`}
        onClick={() => void copy()}
        className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-md bg-black/[0.06] text-text-muted hover:text-text dark:bg-white/[0.08]"
      >
        {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
      </button>
      <pre aria-label={label} className="overflow-x-auto px-5 py-4 pr-12 font-mono text-[12.5px] leading-6 text-text">
        {lines.map((line, index) => (
          <span key={index} className={cn("block min-h-6", line.startsWith("#") && "text-text-muted")}>{line}</span>
        ))}
      </pre>
    </div>
  );
}

export interface CodeTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  code: string;
}

/** The install box: one tab per platform, each with its own commands. */
export function CodeTabs({ tabs, label }: { tabs: CodeTab[]; label: string }): React.JSX.Element {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-surface dark:border-white/[0.1]">
      <div role="tablist" aria-label={label} className="flex flex-wrap border-b border-black/[0.08] dark:border-white/[0.1]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={tab.id === current?.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium",
              tab.id === current?.id ? "border-[var(--ds-accent)] text-text" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-4">{current === undefined ? null : <CodeBlock code={current.code} label={`${current.label} commands`} />}</div>
    </div>
  );
}

/** A numbered step: a circle with its number, an eyebrow (time and topic), a title and its body. */
export function Step({ number, eyebrow, title, children }: { number: number; eyebrow: string; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-labelledby={`step-${number}`} className="relative flex gap-4 border-t border-black/[0.08] py-8 dark:border-white/[0.1]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--ds-accent)]/40 bg-surface text-[13px] font-medium text-[var(--ds-accent)]">{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p className="font-mono text-[10.5px] tracking-widest text-[var(--ds-accent)] uppercase">{eyebrow}</p>
          <h2 id={`step-${number}`} className="mt-1 text-[17px] font-semibold text-text">{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}

export function Callout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="rounded-lg border border-black/[0.08] bg-surface px-4 py-3 text-[13px] text-text-secondary dark:border-white/[0.1]">{children}</p>;
}

export function H2({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="mt-8 text-[18px] font-semibold text-text">{children}</h2>;
}

export function H3({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="mt-5 text-[15px] font-semibold text-text">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-[14px] leading-6 text-text-secondary">{children}</p>;
}

export function Code({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <code className="rounded bg-recessed px-1 py-0.5 font-mono text-[12.5px] text-text">{children}</code>;
}

export function List({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ul className="ml-5 flex list-disc flex-col gap-1.5 text-[14px] leading-6 text-text-secondary">{children}</ul>;
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/[0.08] dark:border-white/[0.1]">
      <table className="w-full min-w-[480px] text-left text-[13px]">
        <thead className="bg-recessed text-[11px] tracking-wide text-text-muted uppercase">
          <tr>{head.map((cell) => <th key={cell} className="px-3 py-2 font-normal">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
              {row.map((cell, column) => <td key={column} className="px-3 py-2 text-text-secondary">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
