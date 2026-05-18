import type { ReadinessRouteViewModel } from '../../readiness/readiness-route.js';
import type { RuntimeAlert } from '../runtime-alerts.js';
import { DesktopShell } from '../shell/desktop-shell.js';
import { SidebarContainer } from '../shell/sidebar-container.js';
import { Button } from '../ui/button.js';
import { PanelCard } from '../ui/panel-card.js';
import { RuntimeAlertBanner } from '../ui/runtime-alert.js';
import { SectionLabel } from '../ui/section-label.js';

interface AiWorkerSignInRequiredScreenProperties {
  isPrimaryActionPending: boolean;
  isSecondaryActionPending: boolean;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
  runtimeAlert: RuntimeAlert | null;
  viewModel: ReadinessRouteViewModel;
}

export function AiWorkerSignInRequiredScreen({
  isPrimaryActionPending,
  isSecondaryActionPending,
  onPrimaryAction,
  onSecondaryAction,
  runtimeAlert,
  viewModel,
}: AiWorkerSignInRequiredScreenProperties) {
  return (
    <DesktopShell
      activeRailItem="setup"
      pageAlert={runtimeAlert ? <RuntimeAlertBanner alert={runtimeAlert} /> : undefined}
      pageIntro="Sign in on this Mac so CV Maxxing can continue."
      pageTitle={viewModel.heading}
      railItems={['setup']}
      sidebar={
        <SidebarContainer>
          <>
            <SectionLabel>Setup</SectionLabel>
            <h2 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-copy-strong)]">
              {viewModel.heading}
            </h2>
            <p className="m-0 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
              Sign in on this Mac so AI can continue.
            </p>
            <div className="flex-1" />
          </>
        </SidebarContainer>
      }
      subtitle="Connect AI"
      statusPill={{
        label: 'Sign in needed',
        tone: 'warning',
      }}
    >
      <PanelCard className="w-full p-6">
        <p className="m-0 text-[18px] font-extrabold text-[var(--color-copy-strong)]">
          Continue on this Mac
        </p>
        <p className="mt-2 max-w-2xl text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
          {viewModel.body}
        </p>
        {viewModel.diagnostic ? (
          <p className="mt-2 text-[13px] leading-[1.4] text-[var(--color-copy-muted)]">
            {viewModel.diagnostic}
          </p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button disabled={isPrimaryActionPending} onClick={onPrimaryAction} tone="primary">
            {isPrimaryActionPending ? 'Continuing...' : 'Continue'}
          </Button>
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="secondary">
            {isSecondaryActionPending ? 'Opening help...' : 'Get help'}
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="mt-4 w-full min-h-[18rem] bg-[var(--color-shell-topbar)] p-[18px]">
        <p className="m-0 text-[13px] font-extrabold text-[var(--color-surface-0)]">
          Waiting for you to sign in
        </p>
      </PanelCard>
    </DesktopShell>
  );
}
