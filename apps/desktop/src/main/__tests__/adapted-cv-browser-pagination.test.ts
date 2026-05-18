// @vitest-environment jsdom

import { expect, test } from 'vitest';
import type { AdaptedCvExperienceEntry } from '../../shared/tailored-application.js';
import {
  type AdaptedCvBrowserRenderPayload,
  type AdaptedCvBrowserSidebarSection,
  doesElementOverflowPageWithBottomClearance,
  doesPageOverflowWithBottomClearance,
  renderAdaptedCvPagesInBrowser,
} from '../adapted-cv-browser-pagination.js';

test('treats a page as full before the last printable pixels to preserve bottom clearance', () => {
  const pageElement = document.createElement('section');

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1125,
    },
  });

  expect(doesPageOverflowWithBottomClearance(pageElement)).toBe(true);
});

test('treats descendant geometry crossing the safe bottom boundary as overflow', () => {
  const pageElement = document.createElement('section');
  const childElement = document.createElement('p');

  pageElement.append(childElement);

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1123,
    },
  });

  pageElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 1123,
      width: 794,
      x: 0,
      y: 0,
    });
  };

  childElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 1088,
    });
  };

  expect(doesPageOverflowWithBottomClearance(pageElement)).toBe(true);
});

test('checks overflow against the appended item instead of unrelated page descendants', () => {
  const pageElement = document.createElement('section');
  const priorDescendantElement = document.createElement('p');
  const appendedElement = document.createElement('p');

  pageElement.append(priorDescendantElement, appendedElement);

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1123,
    },
  });

  pageElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 1123,
      width: 794,
      x: 0,
      y: 0,
    });
  };

  priorDescendantElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 1088,
    });
  };

  appendedElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 900,
    });
  };

  expect(doesElementOverflowPageWithBottomClearance(pageElement, appendedElement)).toBe(false);
});

test('fills the first and continued pages until the measured overflow boundary is reached', () => {
  document.body.innerHTML = '<main class="cv-document" id="cv-document-root"></main>';

  const renderResult = renderAdaptedCvPagesInBrowser(createPayloadWithExperienceCount(8), {
    isPageOverflowing: (pageElement) => {
      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber ?? '1', 10);
      const experienceItems = pageElement.querySelectorAll('.experience-item').length;
      const maximumItems = pageNumber === 1 ? 3 : 5;

      return experienceItems > maximumItems;
    },
  });

  const pages = [...document.querySelectorAll<HTMLElement>('.cv-page')];
  const firstPageExperienceItems = pages[0]?.querySelectorAll('.experience-item').length;
  const secondPageExperienceItems = pages[1]?.querySelectorAll('.experience-item').length;

  expect(renderResult.pageCount).toBe(2);
  expect(pages).toHaveLength(2);
  expect(firstPageExperienceItems).toBe(3);
  expect(secondPageExperienceItems).toBe(5);
  expect(pages[1]?.textContent).toContain('EXPERIENCE (CONTINUED)');
});

test('starts the section on the next page without a continued label when nothing fit on page one', () => {
  document.body.innerHTML = '<main class="cv-document" id="cv-document-root"></main>';

  const renderResult = renderAdaptedCvPagesInBrowser(createPayloadWithExperienceCount(3), {
    isPageOverflowing: (pageElement) => {
      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber ?? '1', 10);
      const experienceItems = pageElement.querySelectorAll('.experience-item').length;

      return pageNumber === 1 ? experienceItems > 0 : false;
    },
  });

  const pages = [...document.querySelectorAll<HTMLElement>('.cv-page')];

  expect(renderResult.pageCount).toBe(2);
  expect(pages[0]?.textContent).not.toContain('EXPERIENCE (CONTINUED)');
  expect(pages[1]?.textContent).toContain('EXPERIENCE');
  expect(pages[1]?.textContent).not.toContain('EXPERIENCE (CONTINUED)');
});

test('renders multiline sidebar blocks and trims optional sidebar content to keep the sidebar on page one', () => {
  document.body.innerHTML = '<main class="cv-document" id="cv-document-root"></main>';

  const renderResult = renderAdaptedCvPagesInBrowser(
    {
      ...createPayloadWithExperienceCount(1),
      rightSections: createOverflowingSidebarSections(),
    },
    {
      isPageOverflowing: (pageElement) => {
        const sidebarElement = pageElement.querySelector('.right-col');

        if (!(sidebarElement instanceof HTMLElement)) {
          return false;
        }

        const totalSidebarLines =
          [...sidebarElement.querySelectorAll<HTMLElement>('.sidebar-multiline')].reduce(
            (lineCount, element) => {
              return lineCount + element.innerHTML.split('\n').length;
            },
            0,
          ) +
          sidebarElement.querySelectorAll('.sidebar-line').length +
          sidebarElement.querySelectorAll('.edu-title, .edu-meta').length;

        return totalSidebarLines > 11;
      },
    },
  );

  const sidebarElement = document.querySelector<HTMLElement>('.right-col');

  if (!(sidebarElement instanceof HTMLElement)) {
    throw new TypeError('Expected the page-one sidebar to be rendered.');
  }

  const sectionLabels = [...sidebarElement.querySelectorAll<HTMLElement>('.section-label')].map(
    (element) => {
      return element.textContent;
    },
  );

  expect(renderResult.pageCount).toBe(1);
  expect(renderResult.rightSections.map((section) => section.label)).toEqual([
    'CORE SKILLS',
    'TOOLS',
    'EDUCATION',
    'LANGUAGES',
    'REFERENCES',
  ]);
  expect(sectionLabels).toEqual(['CORE SKILLS', 'TOOLS', 'EDUCATION', 'LANGUAGES', 'REFERENCES']);
  expect(sidebarElement.querySelector('.section-label')?.parentElement?.className).toBe(
    'sidebar-section-gap-10',
  );
  expect(sidebarElement.textContent).not.toContain('Principal focus');
  expect(sidebarElement.textContent).not.toContain('AWS Certification');
  expect(sidebarElement.textContent).not.toContain('GitHub');
  expect(sidebarElement.textContent).toContain('Swedish (Professional)');
  expect(sidebarElement.querySelectorAll('.sidebar-multiline')).toHaveLength(3);
  expect(sidebarElement.querySelectorAll('.sidebar-section-gap-10')).toHaveLength(3);
});

function createPayloadWithExperienceCount(experienceCount: number): AdaptedCvBrowserRenderPayload {
  return {
    contactLines: ['London, United Kingdom', '+44 7700 900123', 'ada@lovelace.dev'],
    continuableSections: [
      {
        items: Array.from({ length: experienceCount }, (_, index) => {
          return createExperienceEntry(index + 1);
        }),
        kind: 'experience',
        label: 'EXPERIENCE',
      },
    ],
    introLabel: 'Design leader shaping truthful desktop workflow products for technical users.',
    profileText: 'Design leader adapting complex desktop workflow products for technical users.',
    rightSections: [],
    roleLabel: 'Principal Product Designer',
    title: 'Ada Lovelace',
  };
}

function createOverflowingSidebarSections(): AdaptedCvBrowserSidebarSection[] {
  return [
    {
      items: ['Product strategy', 'UX research', 'Prototyping', 'Stakeholder management'],
      kind: 'list',
      label: 'CORE SKILLS',
      sectionKind: 'core_skills',
    },
    {
      items: ['Figma', 'FigJam', 'GitHub'],
      kind: 'list',
      label: 'TOOLS',
      sectionKind: 'tools',
    },
    {
      entry: {
        meta: 'UCL · 2015 — 2018',
        title: 'BSc Computer Science',
      },
      kind: 'education',
      label: 'EDUCATION',
    },
    {
      items: ['AWS Certification'],
      kind: 'list',
      label: 'CERTIFICATIONS',
      sectionKind: 'certifications',
    },
    {
      items: ['English (Native)', 'Swedish (Professional)'],
      kind: 'list',
      label: 'LANGUAGES',
      sectionKind: 'languages',
    },
    {
      items: ['Principal focus'],
      kind: 'list',
      label: 'FOCUS',
      sectionKind: 'focus',
    },
    {
      kind: 'references',
      label: 'REFERENCES',
      text: 'Available on request',
    },
  ];
}

function createExperienceEntry(index: number): AdaptedCvExperienceEntry {
  return {
    bullets: [
      {
        text: `Evidence-backed workflow accomplishment ${String(index)} for technical users.`,
      },
    ],
    dateRange: `20${String(index).padStart(2, '0')} — Present`,
    employer: `Employer ${String(index)}`,
    location: `Location ${String(index)}`,
    roleTitle: `Role ${String(index)}`,
  };
}
