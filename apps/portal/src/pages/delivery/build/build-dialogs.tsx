// The two ways to move a designed unit on (ADR-0071), as dialogs. The implementation and the unit tests are the member's, made on their
// machine with their own AI client and the Kintsugi CLI; Kintsugi only collects which unit they built in which merge request. The
// runtime then reviews that merge request. The page chooses; these say what each does.

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { cliCommands } from "@/lib/build";
import { unitsLine } from "@/lib/design-run";
import { CodeBlock } from "@/pages/guideline/guideline-parts";

export interface ReviewRequest {
  units: string[];
  url: string;
  commit: string;
}

export function ReviewDialog({
  request,
  applicationName,
  targetName,
  documentRepository,
  onConfirm,
  onClose,
}: {
  request: ReviewRequest | undefined;
  applicationName: string;
  targetName: string | undefined;
  documentRepository: string | undefined;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const count = request?.units.length ?? 0;
  return (
    <ConfirmDialog
      open={request !== undefined}
      title={`Review the merge request of ${count} unit${count === 1 ? "" : "s"} of ${applicationName}?`}
      confirmLabel="Review"
      busyLabel="Queuing…"
      confirmVariant="solid"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        An independent reviewer reads the code and the tests the member wrote in {targetName ?? "the target repository"}, at commit <span className="font-mono text-[12px]">{request?.commit.slice(0, 12)}</span> of{" "}
        <a className="underline" href={request?.url} target="_blank" rel="noreferrer">
          the merge request
        </a>
        , against each unit&apos;s rules, design and the project&apos;s standards, through five lenses: fidelity, tests, hidden failures, design and security. It cannot run the code, and it writes no code.
      </p>
      <p className="mt-2 text-text-secondary">
        The findings go to a pull request on {documentRepository ?? "the document repo"} (one review document per unit) for people to read; the member fixes the merge request, records the new commit and asks for another review.
      </p>
      <p className="mt-2 font-mono text-[12px] text-text-secondary">{unitsLine(request?.units ?? [])}</p>
    </ConfirmDialog>
  );
}

export function CliDialog({ unit, url, projectId, onClose }: { unit: string | undefined; url: string; projectId: string; onClose: () => void }): React.JSX.Element {
  return (
    <Modal
      open={unit !== undefined}
      title={`Build ${unit ?? ""} with your own AI client`}
      description="Implement and test the unit on your machine; Kintsugi only records which unit you built in which merge request."
      onClose={onClose}
      size="wide"
      footer={
        <Button size="small" variant="ghost" className="shadow-border" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-[13px] text-text-secondary">
        <p>
          The command reads the unit&apos;s rules and merged design with the Kintsugi tools, plans the files and waits for your yes, writes the code and the unit tests (every test names the rule it pins, and a canary shows the tests can fail), then helps you
          open the merge request. At the end it records the unit, the merge request and its head commit — and the cases it ran — so that the runtime can review it from this page.
        </p>
        {unit === undefined
          ? null
          : cliCommands({ url, projectId, unit }).map((step, index) => (
              <div key={step.title} className="flex flex-col gap-1.5">
                <p className="font-medium text-text">
                  {index + 1}. {step.title}
                </p>
                <CodeBlock code={step.code} label={step.title} />
              </div>
            ))}
        <p className="text-text-muted">After a review, fix the findings in the same merge request, push, and run the command again: it records the new commit, and the review shows as out of date until it is run again here.</p>
      </div>
    </Modal>
  );
}
