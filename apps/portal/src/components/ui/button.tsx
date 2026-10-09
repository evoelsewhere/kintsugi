// Button — DESIGN.md §4: ghost-first, color-only interaction states, radius 6px,
// labels 14px/400, keyboard focus = double ring (2px white + 4px blue). No transforms.
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--geist-radius)] text-[14px] leading-none font-normal focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] disabled:pointer-events-none disabled:text-text-muted [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* Default: fully transparent, hover fills gray and promotes text */
        ghost: "bg-transparent text-text-secondary hover:bg-hover hover:text-text",
        /* Primary: solid near-black */
        solid: "bg-text text-background hover:bg-[#000000]",
        /* Destructive: ghost-style with red label (status colors are never large fills) */
        danger: "bg-transparent text-[var(--ds-status-red)] hover:bg-hover",
        /* Link-like */
        link: "bg-transparent text-accent hover:underline",
      },
      size: {
        small: "h-[var(--geist-form-small-height)] px-3",
        default: "h-[var(--geist-form-height)] px-4",
        large: "h-[var(--geist-form-large-height)] px-6",
        icon: "h-[var(--geist-form-small-height)] w-[var(--geist-form-small-height)] px-0",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps): React.JSX.Element {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
