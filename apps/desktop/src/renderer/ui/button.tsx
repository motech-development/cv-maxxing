import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProperties extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  tone?: 'primary' | 'secondary'
}

export function Button({
  children,
  className,
  tone = 'primary',
  type = 'button',
  ...props
}: ButtonProperties) {
  const toneClassName =
    tone === 'primary'
      ? 'bg-[var(--color-ink-900)] text-[var(--color-surface-0)] hover:bg-[var(--color-ink-800)]'
      : 'bg-[var(--color-surface-2)] text-[var(--color-ink-900)] hover:bg-[var(--color-surface-3)]'

  return (
    <button
      className={`inline-flex items-center justify-center rounded-[var(--radius-card)] border border-transparent px-[14px] py-[10px] text-[13px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName} ${className ?? ''}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}
