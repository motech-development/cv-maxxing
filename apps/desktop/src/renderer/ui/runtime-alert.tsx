import {
  getRuntimeAlertLiveRegionProperties,
  resolveRuntimeAlertLabel,
  type RuntimeAlert,
  type RuntimeAlertItem,
  type RuntimeAlertVariant,
} from '../runtime-alerts.js';

interface RuntimeAlertBannerProperties {
  alert: RuntimeAlert;
}

const toneClassNames: Record<RuntimeAlertVariant, string> = {
  error: 'border-[#E4B7B7] bg-[var(--color-surface-danger)] text-[var(--color-status-danger)]',
  info: 'border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-copy-strong)]',
  success:
    'border-[var(--color-status-muted)]/30 bg-[var(--color-surface-success)] text-[var(--color-copy-strong)]',
  warning: 'border-[#E4D5A7] bg-[var(--color-surface-warning)] text-[var(--color-copy-strong)]',
};

function renderAlertItemLabel(item: RuntimeAlertItem) {
  if (!item.label) {
    return null;
  }

  if (!item.targetId) {
    return <span className="font-extrabold">{item.label}</span>;
  }

  const targetId = item.targetId;

  return (
    <button
      className="cursor-pointer border-0 bg-transparent p-0 font-extrabold text-inherit underline underline-offset-2"
      onClick={() => {
        const target = globalThis.document.querySelector<HTMLElement>(`#${targetId}`);

        if (target) {
          target.focus();
        }
      }}
      type="button"
    >
      {item.label}
    </button>
  );
}

export function RuntimeAlertBanner({ alert }: RuntimeAlertBannerProperties) {
  const liveRegionProperties = getRuntimeAlertLiveRegionProperties(alert.variant);
  const label = resolveRuntimeAlertLabel(alert.variant);

  return (
    <div
      className={`w-full rounded-[10px] border px-[18px] py-4 ${toneClassNames[alert.variant]}`}
      {...liveRegionProperties}
    >
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[11px] font-extrabold">{label}</p>
        {alert.title ? (
          <p className="m-0 text-base font-extrabold leading-[1.25]">{alert.title}</p>
        ) : null}
        {alert.body ? <p className="m-0 text-[13px] leading-[1.4]">{alert.body}</p> : null}
        {alert.items && alert.items.length > 0 ? (
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[13px] leading-[1.4]">
            {alert.items.map((item) => {
              return (
                <li key={item.id}>
                  {renderAlertItemLabel(item)}
                  {item.label ? <span>{': '}</span> : null}
                  <span>{item.description}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
