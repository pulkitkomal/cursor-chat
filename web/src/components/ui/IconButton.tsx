import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tone?: "default" | "accent" | "danger" | "solid";
};

export function IconButton({
  label,
  children,
  tone = "default",
  className = "",
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`icon-btn tone-${tone} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
