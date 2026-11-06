import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "aside" | "header" | "footer" | "section";
  children: ReactNode;
  tone?: "regular" | "clear" | "tint";
};

export function Glass({
  as: Tag = "div",
  children,
  tone = "regular",
  className = "",
  ...rest
}: Props) {
  return (
    <Tag className={`glass glass-${tone} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
