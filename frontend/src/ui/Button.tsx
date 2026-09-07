import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand text-ink-950 font-bold hover:bg-brand-bright disabled:opacity-60",
  secondary: "border border-ink-600 text-ink-100 hover:bg-ink-800 disabled:opacity-40",
  ghost: "text-ink-400 hover:text-ink-100 hover:bg-ink-800/60 disabled:opacity-40",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
}

export function Button({ variant = "primary", icon, className = "", children, ...rest }: Props) {
  return (
    <button
      className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md text-sm transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
