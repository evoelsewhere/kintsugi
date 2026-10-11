// ProviderIcon — brand mark per provider (simple-icons) with a monogram fallback.
// Provider ids come from the pi catalog (`/api/admin/llm-providers/supported`).

import { siAnthropic, siCloudflare, siDeepseek, siGoogle, siGooglecloud, siGooglegemini, siMistralai, siOpenrouter, siPerplexity, siVercel } from "simple-icons";
import { cn } from "@/lib/utils";

interface IconShape {
  path: string;
}

const ICONS: Record<string, IconShape> = {
  anthropic: siAnthropic,
  "ant-ling": siAnthropic,
  openai: { path: siGooglegemini.path }, // placeholder-safe fallback below overrides monogram
  google: siGoogle,
  googleai: siGoogle,
  "google-vertex": siGooglecloud,
  vertex: siGooglecloud,
  "google-generative-ai": siGooglegemini,
  gemini: siGooglegemini,
  mistral: siMistralai,
  mistralai: siMistralai,
  cloudflare: siCloudflare,
  "cloudflare-ai-gateway": siCloudflare,
  "cloudflare-workers-ai": siCloudflare,
  deepseek: siDeepseek,
  perplexity: siPerplexity,
  openrouter: siOpenrouter,
  vercel: siVercel,
  azure: siVercel,
};

export interface ProviderIconProps {
  id: string;
  label?: string;
  className?: string;
}

export function ProviderIcon({ id, label, className }: ProviderIconProps): React.JSX.Element {
  const icon = ICONS[id];
  if (icon !== undefined && id !== "openai" && id !== "azure") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-hidden className={cn("size-4 shrink-0 text-text", className)} fill="currentColor">
        <path d={icon.path} />
      </svg>
    );
  }
  const monogram = (label ?? id).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-recessed text-[8px] font-medium tracking-tight text-text-secondary",
        className,
      )}
    >
      {monogram}
    </span>
  );
}
