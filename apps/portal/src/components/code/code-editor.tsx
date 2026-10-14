// Read-only code view (CodeMirror 6): line numbers, folding, search and syntax colors from the
// design tokens, so it follows light and dark. Loaded on demand by code-view.tsx.

import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { type Extension, EditorState } from "@codemirror/state";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { tags } from "@lezer/highlight";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

function languageOf(path: string): Extension {
  const name = path.toLowerCase();
  if (name.endsWith(".md")) return markdown();
  if (name.endsWith(".py")) return python();
  if (/\.(m?js|cjs|ts|tsx|jsx|json)$/.test(name)) return javascript({ typescript: /\.tsx?$/.test(name) });
  if (/\.(sh|bash)$/.test(name)) return StreamLanguage.define(shell);
  return [];
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: "var(--ds-status-purple-dark, #7820bc)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--ds-status-green-dark, #398e4a)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--ds-status-teal-dark, #067a6e)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--ds-text-muted)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], color: "var(--ds-accent)" },
  { tag: [tags.typeName, tags.className, tags.tagName], color: "var(--ds-status-teal-dark, #067a6e)" },
  { tag: [tags.heading, tags.strong], fontWeight: "600", color: "var(--ds-text-primary)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--ds-accent)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--ds-status-teal-dark, #067a6e)" },
  { tag: [tags.processingInstruction, tags.meta], color: "var(--ds-text-muted)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--ds-background-100)", color: "var(--ds-text-primary)", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "var(--font-mono, 'Geist Mono', ui-monospace, monospace)", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "var(--ds-background-100)", color: "var(--ds-text-muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--ds-accent) 22%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--ds-background-200)", color: "var(--ds-text-primary)" },
});

export default function CodeEditor({ text, path }: { text: string; path: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current === null) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [basicSetup, languageOf(path), syntaxHighlighting(highlight), theme, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping],
      }),
    });
    return () => view.destroy();
  }, [text, path]);
  return <div ref={host} className="h-full min-h-0" role="region" aria-label={`Contents of ${path}`} />;
}
