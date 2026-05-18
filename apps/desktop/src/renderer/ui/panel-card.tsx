import type { HTMLAttributes, ReactNode } from 'react';

interface PanelCardProperties extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PanelCard({ children, className, ...props }: PanelCardProperties) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] ${className ?? ''}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}
