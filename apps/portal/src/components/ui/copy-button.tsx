import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { useToast } from "./toast";

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useToast();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size={iconOnly ? "icon" : "small"}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          },
          (error: unknown) => toast.error("Could not copy", error),
        );
      }}
    >
      {copied ? <Check /> : <Copy />}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  );
}
