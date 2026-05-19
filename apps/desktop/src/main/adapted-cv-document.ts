import type { AdaptedCvModel, AdaptedCvSection } from '../shared/tailored-application.js';
import {
  type AdaptedCvBrowserContinuableSection,
  type AdaptedCvBrowserRenderPayload,
  type AdaptedCvBrowserSidebarSection,
  renderAdaptedCvPagesInBrowser,
} from './adapted-cv-browser-pagination.js';

const PAGE_WARNING_THRESHOLD = 3;
const SAFE_FILENAME_CHARACTER = /[^a-z0-9]+/giu;

interface AdaptedCvDocumentInput {
  adaptedCv: AdaptedCvModel;
  employer: string | null;
  vacancyTitle: string | null;
}

interface AdaptedCvExportFilenameInput {
  candidateName: string;
  vacancyTitle: string | null;
}

export interface AdaptedCvDocument {
  html: string;
}

export function createAdaptedCvDocument(input: AdaptedCvDocumentInput): AdaptedCvDocument {
  const payload = createAdaptedCvRenderPayload(input);

  return {
    html: buildDocumentHtml(payload),
  };
}

export function createAdaptedCvRenderPayload(
  input: AdaptedCvDocumentInput,
): AdaptedCvBrowserRenderPayload {
  const profileSection = getRequiredSection(input.adaptedCv.sections, 'profile');

  return {
    contactLines: buildHeaderContactLines(input.adaptedCv.header.contact),
    continuableSections: buildContinuableSections(input.adaptedCv.sections),
    introLabel: input.adaptedCv.header.intro.text,
    profileText: profileSection.summary.text,
    rightSections: buildRightSections(input.adaptedCv.sections),
    roleLabel: input.adaptedCv.headline.text,
    title: input.adaptedCv.candidateName,
  };
}

export function applyPlannedSidebarSectionsToAdaptedCv(
  adaptedCv: AdaptedCvModel,
  plannedRightSections: AdaptedCvBrowserSidebarSection[],
): AdaptedCvModel {
  const profileSection = getRequiredSection(adaptedCv.sections, 'profile');
  const experienceSection = getRequiredSection(adaptedCv.sections, 'experience');
  const selectedWorkSection = getOptionalSection(adaptedCv.sections, 'selected_work');
  const impactHighlightsSection = getOptionalSection(adaptedCv.sections, 'impact_highlights');
  const referencesSection = getRequiredSection(adaptedCv.sections, 'references');

  const coreSkillsSection = getPlannedSidebarListSection(plannedRightSections, 'core_skills');

  if (coreSkillsSection === null) {
    throw new Error('Planned adapted CV sidebar is missing the core skills section.');
  }

  const nextSections: AdaptedCvSection[] = [
    profileSection,
    experienceSection,
    ...(selectedWorkSection === null ? [] : [selectedWorkSection]),
    ...(impactHighlightsSection === null ? [] : [impactHighlightsSection]),
    {
      items: coreSkillsSection.items.map((item) => {
        return {
          text: item,
        };
      }),
      kind: 'core_skills',
    },
    ...toOptionalSidebarListSection(plannedRightSections, 'tools'),
    ...toOptionalEducationSection(plannedRightSections),
    ...toOptionalSidebarListSection(plannedRightSections, 'certifications'),
    ...toOptionalSidebarListSection(plannedRightSections, 'languages'),
    ...toOptionalSidebarListSection(plannedRightSections, 'focus'),
    referencesSection,
  ];

  return {
    ...adaptedCv,
    sections: nextSections,
  };
}

export function buildAdaptedCvPageWarning(pageCount: number): string | null {
  if (pageCount > PAGE_WARNING_THRESHOLD) {
    return `This adapted CV runs to ${String(pageCount)} pages. Export is still available.`;
  }

  return null;
}

export function buildAdaptedCvExportFilename({
  candidateName,
  vacancyTitle,
}: AdaptedCvExportFilenameInput) {
  const safeCandidateName = sanitizeFilenamePart(candidateName);
  const safeVacancyTitle = sanitizeFilenamePart(vacancyTitle ?? 'adapted cv');

  return `${safeCandidateName} - ${safeVacancyTitle} - adapted-cv.pdf`;
}

export async function resolveUniqueExportFilePath(
  desiredFilePath: string,
  fileExists: (candidatePath: string) => Promise<boolean>,
): Promise<string> {
  const splitIndex = desiredFilePath.lastIndexOf('.');
  const basePath = splitIndex === -1 ? desiredFilePath : desiredFilePath.slice(0, splitIndex);
  const extension = splitIndex === -1 ? '' : desiredFilePath.slice(splitIndex);

  if (await fileExists(desiredFilePath)) {
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidatePath = `${basePath} (${String(suffix)})${extension}`;

      if (!(await fileExists(candidatePath))) {
        return candidatePath;
      }
    }

    return `${basePath} (${String(Date.now())})${extension}`;
  }

  return desiredFilePath;
}

function buildContinuableSections(
  sections: AdaptedCvSection[],
): AdaptedCvBrowserContinuableSection[] {
  const experienceSection = getRequiredSection(sections, 'experience');
  const selectedWorkSection = getOptionalSection(sections, 'selected_work');
  const impactHighlightsSection = getOptionalSection(sections, 'impact_highlights');

  return [
    {
      items: experienceSection.items,
      kind: 'experience',
      label: 'EXPERIENCE',
    },
    ...(selectedWorkSection === null || selectedWorkSection.items.length === 0
      ? []
      : [
          {
            items: selectedWorkSection.items.map((item) => {
              return item.text;
            }),
            kind: 'selected_work' as const,
            label: 'SELECTED WORK' as const,
          },
        ]),
    ...(impactHighlightsSection === null || impactHighlightsSection.items.length === 0
      ? []
      : [
          {
            items: impactHighlightsSection.items.map((item) => {
              return item.text;
            }),
            kind: 'impact_highlights' as const,
            label: 'IMPACT HIGHLIGHTS' as const,
          },
        ]),
  ];
}

function buildRightSections(sections: AdaptedCvSection[]): AdaptedCvBrowserSidebarSection[] {
  const coreSkillsSection = getRequiredSection(sections, 'core_skills');
  const toolsSection = getOptionalSection(sections, 'tools');
  const educationSection = getOptionalSection(sections, 'education');
  const certificationsSection = getOptionalSection(sections, 'certifications');
  const languagesSection = getOptionalSection(sections, 'languages');
  const focusSection = getOptionalSection(sections, 'focus');

  return [
    {
      items: coreSkillsSection.items.map((item) => {
        return item.text;
      }),
      kind: 'list',
      label: 'CORE SKILLS',
      sectionKind: 'core_skills',
    },
    ...createSidebarListSection(toolsSection, 'TOOLS'),
    ...(educationSection?.entry === null || educationSection === null
      ? []
      : [
          {
            entry: educationSection.entry,
            kind: 'education' as const,
            label: 'EDUCATION' as const,
          },
        ]),
    ...createSidebarListSection(certificationsSection, 'CERTIFICATIONS'),
    ...createSidebarListSection(languagesSection, 'LANGUAGES'),
    ...createSidebarListSection(focusSection, 'FOCUS'),
    {
      kind: 'references',
      label: 'REFERENCES',
      text: 'Available on request',
    },
  ];
}

function createSidebarListSection(
  section: Extract<
    AdaptedCvSection,
    {
      items: {
        text: string;
      }[];
    }
  > | null,
  label: string,
): AdaptedCvBrowserSidebarSection[] {
  if (section === null || section.items.length === 0) {
    return [];
  }

  return [
    {
      items: section.items.map((item) => {
        return item.text;
      }),
      kind: 'list',
      label,
      sectionKind: toSidebarListSectionKind(label),
    },
  ];
}

function toSidebarListSectionKind(label: string): Extract<
  AdaptedCvBrowserSidebarSection,
  {
    kind: 'list';
  }
>['sectionKind'] {
  if (label === 'CORE SKILLS') {
    return 'core_skills';
  }

  if (label === 'TOOLS') {
    return 'tools';
  }

  if (label === 'CERTIFICATIONS') {
    return 'certifications';
  }

  if (label === 'LANGUAGES') {
    return 'languages';
  }

  return 'focus';
}

function getPlannedSidebarListSection(
  plannedRightSections: AdaptedCvBrowserSidebarSection[],
  sectionKind: Extract<
    AdaptedCvBrowserSidebarSection,
    {
      kind: 'list';
    }
  >['sectionKind'],
): Extract<
  AdaptedCvBrowserSidebarSection,
  {
    kind: 'list';
  }
> | null {
  const plannedSection = plannedRightSections.find((section) => {
    return section.kind === 'list' && section.sectionKind === sectionKind;
  });

  if (plannedSection?.kind !== 'list') {
    return null;
  }

  return plannedSection;
}

function toOptionalSidebarListSection(
  plannedRightSections: AdaptedCvBrowserSidebarSection[],
  sectionKind: 'certifications' | 'focus' | 'languages' | 'tools',
): AdaptedCvSection[] {
  const plannedSection = getPlannedSidebarListSection(plannedRightSections, sectionKind);

  if (plannedSection === null) {
    return [];
  }

  return [
    {
      items: plannedSection.items.map((item) => {
        return {
          text: item,
        };
      }),
      kind: sectionKind,
    },
  ];
}

function toOptionalEducationSection(
  plannedRightSections: AdaptedCvBrowserSidebarSection[],
): AdaptedCvSection[] {
  const plannedSection = plannedRightSections.find((section) => {
    return section.kind === 'education';
  });

  if (plannedSection?.kind !== 'education') {
    return [];
  }

  return [
    {
      entry: plannedSection.entry,
      kind: 'education',
    },
  ];
}

function getRequiredSection<K extends AdaptedCvSection['kind']>(
  sections: AdaptedCvSection[],
  kind: K,
): Extract<AdaptedCvSection, { kind: K }> {
  const matchingSection = sections.find((section) => {
    return section.kind === kind;
  });

  if (matchingSection === undefined) {
    throw new Error(`Adapted CV is missing the required ${kind} section.`);
  }

  return matchingSection as Extract<AdaptedCvSection, { kind: K }>;
}

function getOptionalSection<K extends AdaptedCvSection['kind']>(
  sections: AdaptedCvSection[],
  kind: K,
): Extract<AdaptedCvSection, { kind: K }> | null {
  const matchingSection = sections.find((section) => {
    return section.kind === kind;
  });

  return matchingSection === undefined
    ? null
    : (matchingSection as Extract<AdaptedCvSection, { kind: K }>);
}

function buildDocumentHtml(payload: AdaptedCvBrowserRenderPayload) {
  const serializedPayload = JSON.stringify(payload)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('\u2028', String.raw`\u2028`)
    .replaceAll('\u2029', String.raw`\u2029`);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Adapted CV</title>',
    '<style>',
    buildDocumentStyles(),
    '</style>',
    '</head>',
    '<body data-cv-ready="pending">',
    '<main class="cv-document" id="cv-document-root"></main>',
    `<script id="adapted-cv-data" type="application/json">${serializedPayload}</script>`,
    '<script>',
    buildPaginationBootstrapScript(),
    '</script>',
    '</body>',
    '</html>',
  ].join('');
}

function buildPaginationBootstrapScript() {
  return [
    '(() => {',
    `const renderPages = ${String(renderAdaptedCvPagesInBrowser)};`,
    'const payloadElement = document.getElementById("adapted-cv-data");',
    'if (!(payloadElement instanceof HTMLScriptElement)) {',
    '  throw new Error("Adapted CV payload script was not found.");',
    '}',
    'const markReady = (renderResult) => {',
    '  document.body.dataset.cvReady = "true";',
    '  document.body.dataset.pageCount = String(renderResult.pageCount);',
    '  document.body.dataset.cvRightSections = JSON.stringify(renderResult.rightSections);',
    '  document.dispatchEvent(new Event("adapted-cv-ready"));',
    '};',
    'const markError = (error) => {',
    '  const message = error instanceof Error ? error.message : String(error);',
    '  document.body.dataset.cvReady = "error";',
    '  document.body.dataset.cvError = message;',
    '  document.dispatchEvent(new Event("adapted-cv-error"));',
    '};',
    'Promise.resolve(document.fonts?.ready ?? true)',
    '  .then(() => {',
    '    const payload = JSON.parse(payloadElement.textContent ?? "{}");',
    '    const renderResult = renderPages(payload);',
    '    markReady(renderResult);',
    '  })',
    '  .catch((error) => {',
    '    markError(error);',
    '  });',
    '})();',
  ].join('\n');
}

function buildDocumentStyles() {
  return `
    :root {
      --bg: #ffffff;
      --text-primary: #1e2428;
      --text-muted: #5e6872;
      --text-subtle: #7a838b;
      --divider: #d9deda;
      --font-sans: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
    }

    @page {
      size: A4;
      margin: 0;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text-primary);
      font-family: var(--font-sans);
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    .cv-document {
      display: block;
    }

    .cv-page {
      width: 794px;
      height: 1123px;
      margin: 0 auto;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      break-after: page;
      page-break-after: always;
    }

    .cv-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .page-1 {
      gap: 34px;
      padding: 52px 58px;
    }

    .cv-page:not(.page-1) {
      gap: 24px;
      padding: 36px 58px 52px;
    }

    .header-main {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
    }

    .identity-main {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-bottom: 2px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .name-main {
      color: var(--text-primary);
      font-size: 44px;
      line-height: normal;
      letter-spacing: 0.4px;
      font-weight: 600;
    }

    .role-main {
      color: var(--text-muted);
      font-size: 20px;
      line-height: normal;
      font-weight: 500;
    }

    .intro-main {
      width: 430px;
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.45;
      font-weight: 400;
    }

    .contact-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
      width: 250px;
      flex: 0 0 250px;
    }

    .contact-list p {
      color: var(--text-primary);
      text-align: right;
      font-size: 12px;
      line-height: normal;
      font-weight: 400;
    }

    .divider {
      width: 100%;
      height: 0;
      border-top: 1px solid var(--divider);
      background: transparent;
    }

    .body-main {
      display: flex;
      gap: 38px;
      align-items: flex-start;
      flex: 1 1 auto;
      min-height: 0;
    }

    .left-col {
      display: flex;
      flex-direction: column;
      gap: 28px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .right-col {
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 232px;
      min-width: 232px;
    }

    .section-label {
      color: var(--text-subtle);
      text-transform: uppercase;
      font-size: 11px;
      line-height: normal;
      letter-spacing: 1.6px;
      font-weight: 600;
    }

    .section-profile {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .profile-text {
      color: var(--text-primary);
      font-size: 13px;
      line-height: 1.65;
    }

    .section-experience {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .section-experience-continued,
    .section-text-block {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .experience-list,
    .text-block-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .experience-item {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .exp-title {
      color: var(--text-primary);
      font-size: 14px;
      line-height: normal;
      font-weight: 600;
    }

    .exp-meta {
      color: var(--text-subtle);
      font-size: 12px;
      line-height: 1.333333;
      font-weight: 400;
    }

    .bullet-row {
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }

    .bullet-mark {
      width: 8px;
      flex: 0 0 8px;
    }

    .bullet-text {
      flex: 1 1 auto;
      min-width: 0;
    }

    .bullet-mark,
    .bullet-text {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .sidebar-section-gap-10 {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sidebar-section-gap-8 {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-line {
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .sidebar-line {
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.333333;
      font-weight: 400;
    }

    .sidebar-multiline {
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.666667;
      font-weight: 400;
      white-space: pre-line;
    }

    .edu-title {
      color: var(--text-primary);
      font-size: 13px;
      line-height: normal;
      font-weight: 600;
    }

    .edu-meta {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .header-continued {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .name-continued {
      color: var(--text-primary);
      font-size: 24px;
      line-height: normal;
      letter-spacing: 0.2px;
      font-weight: 600;
    }

    .role-continued {
      color: var(--text-subtle);
      font-size: 13px;
      line-height: normal;
      font-weight: 500;
    }

    .intro-continued {
      color: var(--text-subtle);
      font-size: 11px;
      line-height: 1.4;
      font-weight: 400;
    }

    .body-continued {
      display: flex;
      flex-direction: column;
      gap: 20px;
      flex: 1 1 auto;
      min-height: 0;
    }

    @media print {
      html,
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .cv-page {
        margin: 0;
      }
    }
  `;
}

function buildHeaderContactLines(contact: AdaptedCvModel['header']['contact']): string[] {
  return [contact.location, contact.phone, contact.email, contact.professionalLink].filter(
    (value): value is string => {
      return value !== null && value.trim() !== '';
    },
  );
}

function sanitizeFilenamePart(value: string) {
  const collapsedWhitespace = value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(SAFE_FILENAME_CHARACTER, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ');

  return collapsedWhitespace === '' ? 'adapted-cv' : collapsedWhitespace;
}
