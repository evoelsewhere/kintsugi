// BrandMark — the Kintsugi mark from assets/brand, inlined as a component.
// Uses the light-background variant (dark plate #1E2A44) because the UI is
// light-only for now; switch to the dark mark when dark tokens land (index.css).
import { useId } from "react";
import { cn } from "../lib/utils";

export function BrandMark({ className }: { className?: string }): React.JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gold = `kintsugi-gold-${uid}`;
  const cut = `kintsugi-cut-${uid}`;
  const plate = "#1E2A44";

  return (
    <svg viewBox="-6 -6 148 148" role="img" aria-label="Kintsugi" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F7D98A" />
          <stop offset=".55" stopColor="#E0B04A" />
          <stop offset="1" stopColor="#B8822A" />
        </linearGradient>
        <clipPath id={cut}>
          <polygon points="-4,-4 124,-4 124,71.6 71.6,124 -4,124" />
        </clipPath>
      </defs>
      <polygon points="0,0 120,0 120,70 70,120 0,120" fill={plate} stroke={plate} strokeWidth="8" strokeLinejoin="round" />
      <g clipPath={`url(#${cut})`} fill="none" stroke={`url(#${gold})`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="48,-6 58,42 36,74 50,126" />
        <polyline points="58,42 126,58" />
      </g>
      <rect x="98" y="98" width="16" height="16" rx="2.5" fill={`url(#${gold})`} />
      <rect x="124" y="94" width="10" height="10" rx="2" fill={plate} />
      <rect x="94" y="124" width="10" height="10" rx="2" fill={plate} />
    </svg>
  );
}
