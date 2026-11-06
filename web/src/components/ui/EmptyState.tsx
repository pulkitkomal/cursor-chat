import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  brand?: string;
  children?: ReactNode;
};

export function EmptyState({ title, description, brand = "Brief", children }: Props) {
  return (
    <div className="empty-state">
      <img className="empty-mark" src="/brief.svg" alt="" width={56} height={56} />
      <p className="empty-brand">{brand}</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
