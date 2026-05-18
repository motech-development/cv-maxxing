import { expect, test } from 'vitest';
import type {
  AdaptedCvExperienceEntry,
  AdaptedCvModel,
} from '../../shared/tailored-application.js';
import {
  buildAdaptedCvExportFilename,
  buildAdaptedCvPageWarning,
  createAdaptedCvDocument,
  createAdaptedCvRenderPayload,
  resolveUniqueExportFilePath,
} from '../adapted-cv-document.js';

function createAdaptedCvInput() {
  const adaptedCv: AdaptedCvModel = {
    candidateName: 'Ada Lovelace',
    header: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      intro: {
        text: 'Design leader shaping truthful desktop workflow products for technical users.',
      },
    },
    headline: {
      text: 'Principal Product Designer',
    },
    sections: [
      {
        kind: 'profile',
        summary: {
          text: 'Design leader adapting complex desktop workflow products for technical users.',
        },
      },
      {
        items: [
          createExperienceEntry({
            bullets: [
              'Led product design for AI-assisted desktop tooling used by technical teams.',
              'Prioritised workflow evidence in the bullet order used for this tailored CV.',
            ],
            dateRange: '2022 — Present',
            employer: 'Analytical Engines Ltd',
            location: 'London',
            roleTitle: 'Lead Product Designer',
          }),
          createExperienceEntry({
            bullets: [
              'Partnered with engineering on complex workflow software for regulated users.',
            ],
            dateRange: '2019 — 2022',
            employer: 'Difference Engines Studio',
            location: 'Stockholm',
            roleTitle: 'Senior Product Designer',
          }),
        ],
        kind: 'experience',
      },
      {
        items: [
          {
            text: 'Product strategy',
          },
          {
            text: 'UX research',
          },
          {
            text: 'Prototyping',
          },
        ],
        kind: 'core_skills',
      },
      {
        kind: 'references',
      },
    ],
  };

  return {
    adaptedCv,
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  };
}

test('renders an adapted CV html shell that bootstraps browser pagination', () => {
  const document = createAdaptedCvDocument(createAdaptedCvInput());

  expect(document.html).toContain('<main class="cv-document" id="cv-document-root"></main>');
  expect(document.html).toContain('<script id="adapted-cv-data" type="application/json">');
  expect(document.html).toContain('const renderPages = function renderAdaptedCvPagesInBrowser');
  expect(document.html).not.toContain('DEFAULT_ROOT_ELEMENT_ID');
  expect(document.html).not.toContain('doesPageOverflowWithBottomClearance');
  expect(document.html).not.toContain('doesElementOverflowPageWithBottomClearance');
  expect(document.html).not.toContain('planSidebarSectionsForPageOneFit');
  expect(document.html).not.toContain('cloneSidebarSections');
  expect(document.html).not.toContain('doesSidebarOverflowPage');
  expect(document.html).not.toContain('applyNextSidebarOmission');
  expect(document.html).not.toContain('trimListSectionItem');
  expect(document.html).not.toContain('dropSection');
  expect(document.html).not.toContain('isMultilineSidebarSection');
  expect(document.html).toContain('Ada Lovelace');
  expect(document.html).toContain('Principal Product Designer');
  expect(document.html).not.toContain('Tailored for');
  expect(document.html).not.toContain('<p>Adapted CV</p>');
  expect(document.html).not.toContain('PDF preview artifact');
});

test('builds canonical payload ordering and preserves contact priority ordering', () => {
  const input = createAdaptedCvInput();
  const [profileSection, experienceSection, coreSkillsSection, referencesSection] =
    input.adaptedCv.sections;

  if (
    profileSection === undefined ||
    experienceSection === undefined ||
    coreSkillsSection === undefined ||
    referencesSection === undefined
  ) {
    throw new Error(
      'Expected the mandatory adapted-CV sections to be present in the test fixture.',
    );
  }

  input.adaptedCv.sections = [
    referencesSection,
    experienceSection,
    profileSection,
    coreSkillsSection,
  ];

  const payload = createAdaptedCvRenderPayload(input);

  expect(payload.profileText).toContain('Design leader adapting complex desktop workflow products');
  expect(payload.continuableSections.map((section) => section.label)).toEqual(['EXPERIENCE']);
  expect(payload.rightSections.map((section) => section.label)).toEqual([
    'CORE SKILLS',
    'REFERENCES',
  ]);
  expect(payload.contactLines).toEqual([
    'London, United Kingdom',
    '+44 7700 900123',
    'ada@lovelace.dev',
    'ada-lovelace.dev',
  ]);
});

test('preserves structured experience chronology and bullet ordering in the render payload', () => {
  const payload = createAdaptedCvRenderPayload(createAdaptedCvInput());
  const experienceSection = payload.continuableSections[0];

  if (experienceSection?.kind !== 'experience') {
    throw new Error('Expected the first continuable section to be experience.');
  }

  const [newestRole, olderRole] = experienceSection.items;

  expect(newestRole?.roleTitle).toBe('Lead Product Designer');
  expect(newestRole?.employer).toBe('Analytical Engines Ltd');
  expect(newestRole?.bullets[0]?.text).toBe(
    'Led product design for AI-assisted desktop tooling used by technical teams.',
  );
  expect(newestRole?.bullets[1]?.text).toBe(
    'Prioritised workflow evidence in the bullet order used for this tailored CV.',
  );
  expect(olderRole?.roleTitle).toBe('Senior Product Designer');
  expect(olderRole?.employer).toBe('Difference Engines Studio');
});

test('omits optional left-column evidence sections when they are empty', () => {
  const input = createAdaptedCvInput();

  input.adaptedCv.sections = [
    ...input.adaptedCv.sections,
    {
      items: [],
      kind: 'selected_work',
    },
    {
      items: [],
      kind: 'impact_highlights',
    },
  ];

  const payload = createAdaptedCvRenderPayload(input);

  expect(payload.continuableSections.map((section) => section.label)).toEqual(['EXPERIENCE']);
});

test('builds sidebar sections in canonical order for the page one rail', () => {
  const input = createAdaptedCvInput();

  input.adaptedCv.sections = [
    ...input.adaptedCv.sections,
    {
      items: [
        {
          text: 'Operator workflow trust',
        },
        {
          text: 'Technical product design',
        },
      ],
      kind: 'focus',
    },
    {
      items: [
        {
          text: 'English (Native)',
        },
        {
          text: 'Swedish (Professional)',
        },
      ],
      kind: 'languages',
    },
    {
      items: [
        {
          text: 'NN/g UX Certification',
        },
        {
          text: 'Google Analytics 4',
        },
      ],
      kind: 'certifications',
    },
    {
      entry: {
        meta: 'UCL · 2015 — 2018',
        title: 'BSc Computer Science',
      },
      kind: 'education',
    },
    {
      items: [
        {
          text: 'Figma',
        },
        {
          text: 'FigJam',
        },
        {
          text: 'Miro',
        },
      ],
      kind: 'tools',
    },
  ];

  const payload = createAdaptedCvRenderPayload(input);

  expect(payload.rightSections.map((section) => section.label)).toEqual([
    'CORE SKILLS',
    'TOOLS',
    'EDUCATION',
    'CERTIFICATIONS',
    'LANGUAGES',
    'FOCUS',
    'REFERENCES',
  ]);
});

test('builds a non-blocking warning only when the actual page count exceeds the threshold', () => {
  expect(buildAdaptedCvPageWarning(3)).toBeNull();
  expect(buildAdaptedCvPageWarning(4)).toBe(
    'This adapted CV runs to 4 pages. Export is still available.',
  );
});

test('uses generalized continued-page padding without a header inset hack', () => {
  const document = createAdaptedCvDocument(createAdaptedCvInput());

  expect(document.html).toContain('.cv-page:not(.page-1)');
  expect(document.html).toContain('padding: 36px 58px 52px;');
  expect(document.html).not.toContain('padding: 36px 58px 0;');
});

test('includes the template-aligned multiline sidebar styles from design/cv.html', () => {
  const document = createAdaptedCvDocument(createAdaptedCvInput());

  expect(document.html).toContain('.sidebar-section-gap-10');
  expect(document.html).toContain('.sidebar-multiline');
  expect(document.html).toContain('white-space: pre-line;');
});

test('keeps selected work ahead of impact highlights in the continuable payload order', () => {
  const input = createAdaptedCvInput();

  input.adaptedCv.sections = [
    ...input.adaptedCv.sections,
    {
      items: Array.from({ length: 3 }, (_, index) => {
        return {
          text:
            `Selected work line ${String(index + 1)} with grounded workflow evidence for ` +
            'technical users and regulated review tooling.',
        };
      }),
      kind: 'selected_work',
    },
    {
      items: [
        {
          text: 'Impact highlight line 1 showing measurable workflow adoption gains.',
        },
        {
          text: 'Impact highlight line 2 showing improved operator throughput and trust.',
        },
      ],
      kind: 'impact_highlights',
    },
  ];

  const payload = createAdaptedCvRenderPayload(input);

  expect(payload.continuableSections.map((section) => section.label)).toEqual([
    'EXPERIENCE',
    'SELECTED WORK',
    'IMPACT HIGHLIGHTS',
  ]);
});

test('builds safe readable export names and resolves overwrite collisions without silent replacement', async () => {
  const exportFilename = buildAdaptedCvExportFilename({
    candidateName: 'Ada Lovelace / Principal Designer',
    vacancyTitle: 'Senior platform engineer: growth & workflow',
  });

  expect(exportFilename).toBe(
    'Ada Lovelace Principal Designer - Senior platform engineer growth workflow - adapted-cv.pdf',
  );

  await expect(
    resolveUniqueExportFilePath(
      '/exports/Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
      (candidatePath) => {
        return Promise.resolve(
          candidatePath === '/exports/Ada Lovelace - Senior platform engineer - adapted-cv.pdf' ||
            candidatePath ===
              '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
        );
      },
    ),
  ).resolves.toBe('/exports/Ada Lovelace - Senior platform engineer - adapted-cv (3).pdf');
});

function createExperienceEntry({
  bullets,
  dateRange,
  employer,
  location,
  roleTitle,
}: {
  bullets: string[];
  dateRange: string;
  employer: string;
  location: string | null;
  roleTitle: string;
}): AdaptedCvExperienceEntry {
  return {
    bullets: bullets.map((text) => {
      return {
        text,
      };
    }),
    dateRange,
    employer,
    location,
    roleTitle,
  };
}
