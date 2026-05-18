import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProperties extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: 'danger' | 'primary' | 'secondary';
}

export function Button({
  children,
  className,
  tone = 'primary',
  type = 'button',
  ...props
}: ButtonProperties) {
  let toneClassName =
    'bg-[var(--color-ink-900)] text-[var(--color-surface-0)] hover:bg-[var(--color-ink-800)]';

  if (tone === 'danger') {
    toneClassName =
      'border-[var(--color-status-danger)]/25 bg-[var(--color-surface-danger)] text-[var(--color-status-danger)] hover:bg-[#ffe5e5]';
  } else if (tone === 'secondary') {
    toneClassName =
      'bg-[var(--color-surface-2)] text-[var(--color-ink-900)] hover:bg-[var(--color-surface-3)]';
  }

  return (
    <button
      className={`inline-flex items-center justify-center rounded-[var(--radius-card)] border border-transparent px-[14px] py-[10px] text-[13px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName} ${className ?? ''}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
