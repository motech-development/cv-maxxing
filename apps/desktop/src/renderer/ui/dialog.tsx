import { type ReactNode, type SyntheticEvent, useEffect, useId, useRef } from 'react';

import type { RuntimeAlert } from '../runtime-alerts.js';
import { RuntimeAlertBanner } from './runtime-alert.js';

interface DialogProperties {
  actions: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  isDismissable?: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  runtimeAlert?: RuntimeAlert | null;
  title: string;
}

export function Dialog({
  actions,
  children,
  eyebrow,
  isDismissable = true,
  isOpen,
  onOpenChange,
  runtimeAlert,
  title,
}: DialogProperties) {
  const dialogReference = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialogElement = dialogReference.current;

    if (dialogElement === null) {
      return;
    }

    if (typeof dialogElement.showModal === 'function' && !dialogElement.open) {
      dialogElement.showModal();

      return () => {
        if (dialogElement.open) {
          dialogElement.close();
        }
      };
    }

    dialogElement.setAttribute('open', '');

    return () => {
      dialogElement.removeAttribute('open');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialogElement = dialogReference.current;

    if (dialogElement === null) {
      return;
    }

    const handleBackdropClick = (event: Event): void => {
      if (event.target !== dialogElement) {
        return;
      }

      event.preventDefault();

      if (!isDismissable) {
        return;
      }

      onOpenChange(false);
    };

    dialogElement.addEventListener('click', handleBackdropClick);

    return () => {
      dialogElement.removeEventListener('click', handleBackdropClick);
    };
  }, [isDismissable, isOpen, onOpenChange]);

  if (!isOpen) {
    return null;
  }

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();

    if (!isDismissable) {
      return;
    }

    onOpenChange(false);
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className="app-dialog fixed top-1/2 left-1/2 m-0 w-[min(520px,calc(100vw-48px))] max-w-none -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-[#C7D0CA] bg-[#FCFDFC] p-0 text-[var(--color-copy-strong)] shadow-[0_8px_24px_rgba(30,36,40,0.1)]"
      onCancel={handleCancel}
      ref={dialogReference}
    >
      <div className="flex flex-col gap-[18px] p-6">
        <div className="flex flex-col gap-1">
          {eyebrow ? (
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-muted)]">
              {eyebrow}
            </p>
          ) : null}
          <h2
            className="m-0 text-[26px] font-extrabold tracking-[-0.03em] text-[var(--color-copy-strong)]"
            id={titleId}
          >
            {title}
          </h2>
        </div>
        {runtimeAlert ? <RuntimeAlertBanner alert={runtimeAlert} /> : null}
        <div className="flex flex-col gap-3 text-[13px] leading-[1.45] text-[var(--color-copy-muted)]">
          {children}
        </div>
        <div className="flex justify-end gap-2.5">{actions}</div>
      </div>
    </dialog>
  );
}
