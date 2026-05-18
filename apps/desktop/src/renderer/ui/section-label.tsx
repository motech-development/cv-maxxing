import type { ReactNode } from 'react';

interface SectionLabelProperties {
  children: ReactNode;
}

export function SectionLabel({ children }: SectionLabelProperties) {
  return (
    <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
      {children}
    </p>
  );
}
