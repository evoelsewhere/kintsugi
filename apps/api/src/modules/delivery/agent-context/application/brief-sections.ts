// Selects complete, approved Markdown sections for a bounded deterministic task brief.

import type { ContextSection, OmittedSection } from "@kintsugi/harness-sdk";
import type { SnapshotSource } from "../domain/snapshot.js";

export interface BriefSectionSelection {
  sections: ContextSection[];
  omittedSections: OmittedSection[];
  requiredContextStatus: "complete" | "partial";
}

export function selectBriefSections(
  sources: readonly SnapshotSource[],
  sourceTexts: ReadonlyMap<string, string>,
  maxBytes: number,
): BriefSectionSelection {
  const candidates = sources.flatMap((source) => source.sections.map((section) => ({ source, section })))
    .sort((left, right) => Number(right.section.required) - Number(left.section.required)
      || left.source.repositoryId.localeCompare(right.source.repositoryId)
      || left.source.path.localeCompare(right.source.path)
      || left.section.startLine - right.section.startLine);
  const sections: ContextSection[] = [];
  const omittedSections: OmittedSection[] = [];
  let remainingBytes = Math.max(0, maxBytes);

  for (const { source, section } of candidates) {
    const markdown = sourceTexts.get(source.sourceId);
    if (!source.readable || source.availability !== "present" || markdown === undefined) {
      if (section.required) omittedSections.push({ sourceId: source.sourceId, sectionId: section.sectionId, required: true });
      continue;
    }

    const text = markdown.split(/\r\n|\n|\r/).slice(section.startLine - 1, section.endLine).join("\n");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > remainingBytes) {
      if (section.required) omittedSections.push({ sourceId: source.sourceId, sectionId: section.sectionId, required: true });
      continue;
    }

    remainingBytes -= bytes;
    sections.push({
      sourceId: source.sourceId,
      sectionId: section.sectionId,
      title: section.title,
      text,
      required: section.required,
      citation: {
        sourceId: source.sourceId,
        path: source.path,
        startLine: section.startLine,
        endLine: section.endLine,
      },
    });
  }

  for (const source of sources) {
    if (source.required && source.sections.length === 0) {
      omittedSections.push({ sourceId: source.sourceId, sectionId: "unavailable", required: true });
    }
  }

  sections.sort((left, right) => left.sourceId.localeCompare(right.sourceId)
    || (left.citation.startLine ?? 0) - (right.citation.startLine ?? 0));
  omittedSections.sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.sectionId.localeCompare(right.sectionId));
  return {
    sections,
    omittedSections,
    requiredContextStatus: omittedSections.some((section) => section.required) ? "partial" : "complete",
  };
}
