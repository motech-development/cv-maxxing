interface StatusPillProperties {
  label: string;
  tone: 'danger' | 'muted' | 'ready' | 'warning';
}

const toneClassNames: Record<StatusPillProperties['tone'], string> = {
  danger: 'bg-[var(--color-chip-background)] text-[var(--color-surface-3)]',
  muted: 'bg-[var(--color-chip-background)] text-[var(--color-surface-3)]',
  ready: 'bg-[var(--color-chip-background)] text-[var(--color-surface-0)]',
  warning: 'bg-[var(--color-chip-background)] text-[var(--color-surface-3)]',
};

function getDotClassName(tone: StatusPillProperties['tone']) {
  if (tone === 'ready') {
    return 'bg-[var(--color-status-ready)]';
  }

  if (tone === 'warning') {
    return 'bg-[var(--color-status-warning)]';
  }

  if (tone === 'danger') {
    return 'bg-[var(--color-status-danger)]';
  }

  return 'bg-[var(--color-status-muted)]';
}

export function StatusPill({ label, tone }: StatusPillProperties) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ${toneClassNames[tone]}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${getDotClassName(tone)}`} />
      {label}
    </span>
  );
}
