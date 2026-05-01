export type VacancyUrlIntakeInteractionRequest =
  | {
      action: 'click'
      selector: string
    }
  | {
      action: 'scroll'
      direction: 'down' | 'up'
      selector?: string
    }
  | {
      action: 'set_hash'
      hash: string
    }

export type VacancyUrlIntakeInteractionResult =
  | {
      afterUrl: string
      status: 'applied'
    }
  | {
      afterUrl: string
      reason: string
      status: 'rejected'
    }

export class VacancyUrlIntakeInteractionRequestError extends Error {
  readonly interaction: VacancyUrlIntakeInteractionRequest

  constructor(interaction: VacancyUrlIntakeInteractionRequest) {
    super('Vacancy URL intake requires a same-page reading interaction.')
    this.name = 'VacancyUrlIntakeInteractionRequestError'
    this.interaction = interaction
  }
}

export function createVacancyUrlIntakeInteractionScript({
  interaction,
}: {
  interaction: VacancyUrlIntakeInteractionRequest
}): string {
  return `(() => {
    const interaction = ${JSON.stringify(interaction)};
    const blockedActionTextPattern = /\\b(apply|application|submit|sign\\s*in|log\\s*in|login|account|profile|upload|attach|resume|cv)\\b/i;

    const reject = (reason) => {
      return {
        afterUrl: window.location.href,
        reason,
        status: 'rejected',
      };
    };

    const apply = () => {
      return {
        afterUrl: window.location.href,
        status: 'applied',
      };
    };

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const normalizeTopLevelUrl = (value) => {
      const url = new URL(value, window.location.href);

      return [
        url.protocol.toLowerCase(),
        '//',
        url.host.toLowerCase(),
        url.pathname.replace(/\\/+$/u, '') || '/',
        url.search,
      ].join('');
    };

    const isHashOnlyUrlChange = (candidateUrl) => {
      return normalizeTopLevelUrl(candidateUrl) === normalizeTopLevelUrl(window.location.href);
    };

    const textFor = (element) => {
      return [
        element.textContent || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('value') || '',
        element.getAttribute('name') || '',
      ].join(' ');
    };

    if (interaction.action === 'scroll') {
      const scrollTarget = interaction.selector === undefined
        ? window
        : document.querySelector(interaction.selector);

      if (scrollTarget === null) {
        return reject('scroll-target-not-found');
      }

      const delta = Math.round(window.innerHeight * 0.85) * (interaction.direction === 'up' ? -1 : 1);

      if (scrollTarget === window) {
        window.scrollBy({
          behavior: 'instant',
          top: delta,
        });

        return apply();
      }

      if (!(scrollTarget instanceof Element) || !isVisible(scrollTarget)) {
        return reject('scroll-target-not-visible');
      }

      scrollTarget.scrollBy({
        behavior: 'instant',
        top: delta,
      });

      return apply();
    }

    if (interaction.action === 'set_hash') {
      if (typeof interaction.hash !== 'string' || interaction.hash.trim() === '') {
        return reject('hash-required');
      }

      const nextHash = interaction.hash.startsWith('#') ? interaction.hash : \`#\${interaction.hash}\`;
      window.location.hash = nextHash;

      return apply();
    }

    if (interaction.action !== 'click') {
      return reject('unsupported-action');
    }

    if (typeof interaction.selector !== 'string' || interaction.selector.trim() === '') {
      return reject('selector-required');
    }

    let target = null;

    try {
      target = document.querySelector(interaction.selector);
    } catch {
      return reject('invalid-selector');
    }

    if (!(target instanceof Element) || !isVisible(target)) {
      return reject('click-target-not-visible');
    }

    const formControl = target.closest('input, textarea, select, option, label');

    if (formControl !== null) {
      return reject('form-field-action-rejected');
    }

    const fileInput = target.closest('input[type="file"]');

    if (fileInput !== null) {
      return reject('file-upload-rejected');
    }

    const form = target.closest('form');
    const button = target.closest('button, [role="button"], input[type="button"], input[type="submit"]');
    const link = target.closest('a[href], area[href]');
    const targetText = textFor(target);

    if (blockedActionTextPattern.test(targetText)) {
      return reject('blocked-action-text');
    }

    if (form !== null) {
      return reject('form-action-rejected');
    }

    if (button !== null && blockedActionTextPattern.test(textFor(button))) {
      return reject('blocked-button-action');
    }

    if (button instanceof HTMLButtonElement && button.type.toLowerCase() === 'submit') {
      return reject('submit-button-rejected');
    }

    if (link !== null) {
      const href = link.getAttribute('href');

      if (href === null || href.trim() === '') {
        return reject('empty-link-rejected');
      }

      const linkedUrl = new URL(href, window.location.href).href;

      if (!isHashOnlyUrlChange(linkedUrl)) {
        return reject('top-level-navigation-rejected');
      }
    }

    target.click();

    return apply();
  })()`
}

export function isVacancyUrlIntakeInteractionRequest(
  value: unknown,
): value is VacancyUrlIntakeInteractionRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  if (candidate.action === 'click') {
    return typeof candidate.selector === 'string' && candidate.selector.trim() !== ''
  }

  if (candidate.action === 'scroll') {
    return (
      (candidate.direction === 'down' || candidate.direction === 'up') &&
      (candidate.selector === undefined || typeof candidate.selector === 'string')
    )
  }

  if (candidate.action === 'set_hash') {
    return typeof candidate.hash === 'string' && candidate.hash.trim() !== ''
  }

  return false
}

export function isVacancyUrlIntakeInteractionResult(
  value: unknown,
): value is VacancyUrlIntakeInteractionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  if (candidate.status === 'applied') {
    return typeof candidate.afterUrl === 'string'
  }

  return (
    candidate.status === 'rejected' &&
    typeof candidate.afterUrl === 'string' &&
    typeof candidate.reason === 'string'
  )
}
