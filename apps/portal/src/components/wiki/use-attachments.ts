// The attachments of the draft being edited: the list the server holds, adding files (a button, a paste or a drop) and
// removing one. A file is checked before it is sent (type and size); the server checks again. What the server answers
// (the final name and the Markdown to insert) is what goes into the text.

import { useCallback, useEffect, useRef, useState } from "react";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { errorText } from "@/lib/format";
import { type AttachmentView, attachmentProblem, attachmentTypeOf, toBase64 } from "@/lib/wiki-edit";

export interface Attachments {
  items: AttachmentView[];
  busy: boolean;
  /** Why the last file was refused or failed, in words; null when all is well. */
  problem: string | null;
  attach: (files: readonly File[]) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

/** `insert` puts the Markdown of an attached file at the cursor of the editor. */
export function useAttachments(projectId: string, path: string, insert: (markdown: string) => void, draftReady: () => Promise<unknown>): Attachments {
  const [items, setItems] = useState<AttachmentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const held = useRef(0);
  const insertRef = useRef(insert);
  const readyRef = useRef(draftReady);
  useEffect(() => {
    insertRef.current = insert;
    readyRef.current = draftReady;
  }, [insert, draftReady]);

  useEffect(() => {
    let current = true;
    wikiEditApi.attachments(projectId, path).then(
      (list) => {
        if (!current) return;
        held.current = list.reduce((sum, item) => sum + item.size, 0);
        setItems(list);
      },
      // A draft that does not exist yet has no attachments; an API without the route has none either.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [projectId, path]);

  const attach = useCallback(
    async (files: readonly File[]): Promise<void> => {
      setBusy(true);
      setProblem(null);
      try {
        for (const file of files) {
          const refused = attachmentProblem(file, held.current);
          if (refused !== undefined) {
            setProblem(refused);
            continue;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          // The attachment belongs to the draft: a page opened and not changed has none yet, so it is saved first.
          await readyRef.current();
          const stored = await wikiEditApi.attach(projectId, { path, name: file.name, contentType: file.type !== "" ? file.type : (attachmentTypeOf(file.name) ?? ""), contentBase64: toBase64(bytes) });
          held.current += stored.size;
          setItems((current) => [...current.filter((item) => item.name !== stored.name), stored]);
          insertRef.current(stored.markdown);
        }
      } catch (error) {
        setProblem(errorText(error));
      } finally {
        setBusy(false);
      }
    },
    [projectId, path],
  );

  const remove = useCallback(
    async (name: string): Promise<void> => {
      setProblem(null);
      try {
        await wikiEditApi.detach(projectId, path, name);
        setItems((current) => {
          const gone = current.find((item) => item.name === name);
          held.current -= gone?.size ?? 0;
          return current.filter((item) => item.name !== name);
        });
      } catch (error) {
        setProblem(errorText(error));
      }
    },
    [projectId, path],
  );

  return { items, busy, problem, attach, remove };
}
