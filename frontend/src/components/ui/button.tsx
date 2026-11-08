// The button (docs/spec/diseno.md 10.1): spider-ui's panel buttons (v-btn-*), with the brand violet on the
// main action (sf-brand, styles/spider-brand.css). The variants keep their names; Radix Slot (asChild) too.
import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "warning" | "link";
type Size = "sm" | "md" | "lg" | "icon";

/** What spider-ui doesn't have (an amber action, a text link) stays on the preset's tokens. */
const OWN =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50";

const variantClass: Record<Variant, string> = {
  primary: "v-btn-primary sf-brand",
  secondary: "v-btn-secondary",
  outline: "v-btn-secondary",
  ghost: "v-btn-ghost",
  destructive: "v-btn-danger",
  warning: `${OWN} h-9 px-3.5 bg-warning text-warning-foreground hover:bg-warning/90`,
  link: `${OWN} h-auto px-0 text-primary underline-offset-4 hover:underline`,
};

export function buttonVariants({
  variant = "primary",
  size = "md",
}: { variant?: Variant | null | undefined; size?: Size | null | undefined } = {}): string {
  const v = variant ?? "primary";
  const s = size ?? "md";
  // A ghost icon is spider-ui's icon button; any other icon button is a square of the same height.
  const base = v === "ghost" && s === "icon" ? "v-btn-icon" : variantClass[v];
  const sizing =
    s === "sm"
      ? "v-btn--sm"
      : s === "lg"
        ? "px-5 py-2.5 text-sm"
        : s === "icon" && v !== "ghost"
          ? "size-9 p-0"
          : "";
  return cn(base, sizing, "active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | null;
  size?: Size | null;
  /** Renders the child (e.g. a Link) with the button's styles. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...(asChild ? {} : { type: type ?? "button" })}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
