import { expect, test } from 'vitest'

import {
  buildAdaptedCvExportFilename,
  createAdaptedCvDocument,
  resolveUniqueExportFilePath,
} from '../adapted-cv-document.js'
import type { AdaptedCvExperienceEntry, AdaptedCvModel } from '../../shared/tailored-application.js'

function createAdaptedCvInput(): {
  adaptedCv: AdaptedCvModel
  employer: string
  vacancyTitle: string
} {
  return {
    adaptedCv: {
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
        text: 'Principal Product Designer for desktop workflow products',
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
    },
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  }
}

test('renders a single-page adapted CV document using the authoritative v1 section structure', () => {
  const document = createAdaptedCvDocument(createAdaptedCvInput())

  expect(document.pageCount).toBe(1)
  expect(document.pageWarning).toBeNull()
  expect(document.html).toContain('class="cv-page page-1"')
  expect(document.html).toContain('Ada Lovelace')
  expect(document.html).toContain('Principal Product Designer for desktop workflow products')
  expect(document.html).toContain('Design leader shaping truthful desktop workflow products')
  expect(document.html).toContain('London, United Kingdom')
  expect(document.html).toContain('+44 7700 900123')
  expect(document.html).toContain('ada@lovelace.dev')
  expect(document.html).toContain('ada-lovelace.dev')
  expect(document.html).toContain('PROFILE')
  expect(document.html).toContain('EXPERIENCE')
  expect(document.html).toContain('Lead Product Designer · Analytical Engines Ltd')
  expect(document.html).toContain('London · 2022 — Present')
  expect(document.html).toContain('CORE SKILLS')
  expect(document.html).toContain('REFERENCES')
  expect(document.html).toContain('Available on request')
  expect(document.html).not.toContain('Tailored for')
  expect(document.html).not.toContain('<p>Adapted CV</p>')
  expect(document.html).not.toContain('PDF preview artifact')
  expect(document.html).not.toContain('(CONTINUED)')
})

test('renders mandatory sections in canonical template order and preserves contact priority ordering', () => {
  const input = createAdaptedCvInput()
  const [profileSection, experienceSection, coreSkillsSection, referencesSection] =
    input.adaptedCv.sections

  if (
    profileSection === undefined ||
    experienceSection === undefined ||
    coreSkillsSection === undefined ||
    referencesSection === undefined
  ) {
    throw new Error('Expected the mandatory adapted-CV sections to be present in the test fixture.')
  }

  input.adaptedCv.sections = [
    referencesSection,
    experienceSection,
    profileSection,
    coreSkillsSection,
  ]

  const document = createAdaptedCvDocument(input)
  const profileIndex = document.html.indexOf('PROFILE')
  const experienceIndex = document.html.indexOf('EXPERIENCE')
  const coreSkillsIndex = document.html.indexOf('CORE SKILLS')
  const referencesIndex = document.html.indexOf('REFERENCES')
  const locationIndex = document.html.indexOf('London, United Kingdom')
  const phoneIndex = document.html.indexOf('+44 7700 900123')
  const emailIndex = document.html.indexOf('ada@lovelace.dev')
  const linkIndex = document.html.indexOf('ada-lovelace.dev')

  expect(profileIndex).toBeGreaterThan(-1)
  expect(experienceIndex).toBeGreaterThan(profileIndex)
  expect(coreSkillsIndex).toBeGreaterThan(experienceIndex)
  expect(referencesIndex).toBeGreaterThan(coreSkillsIndex)
  expect(locationIndex).toBeGreaterThan(-1)
  expect(phoneIndex).toBeGreaterThan(locationIndex)
  expect(emailIndex).toBeGreaterThan(phoneIndex)
  expect(linkIndex).toBeGreaterThan(emailIndex)
})

test('renders structured experience entries with chronology and within-role bullet ordering preserved', () => {
  const document = createAdaptedCvDocument(createAdaptedCvInput())
  const newestRoleIndex = document.html.indexOf('Lead Product Designer · Analytical Engines Ltd')
  const olderRoleIndex = document.html.indexOf(
    'Senior Product Designer · Difference Engines Studio',
  )
  const firstBulletIndex = document.html.indexOf(
    'Led product design for AI-assisted desktop tooling used by technical teams.',
  )
  const secondBulletIndex = document.html.indexOf(
    'Prioritised workflow evidence in the bullet order used for this tailored CV.',
  )

  expect(newestRoleIndex).toBeGreaterThan(-1)
  expect(olderRoleIndex).toBeGreaterThan(newestRoleIndex)
  expect(firstBulletIndex).toBeGreaterThan(newestRoleIndex)
  expect(secondBulletIndex).toBeGreaterThan(firstBulletIndex)
})

test('omits optional left-column evidence sections when they are empty', () => {
  const input = createAdaptedCvInput()

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
  ]

  const document = createAdaptedCvDocument(input)

  expect(document.html).not.toContain('SELECTED WORK')
  expect(document.html).not.toContain('IMPACT HIGHLIGHTS')
})

test('creates continued headers and a non-blocking warning when pagination exceeds the v1 threshold', () => {
  const longInput = createAdaptedCvInput()

  longInput.adaptedCv.sections[1] = {
    items: Array.from({ length: 18 }, (_, index) => {
      const itemNumber = String(index + 1)

      return createExperienceEntry({
        bullets: [
          `Owned complex desktop workflow redesign ${itemNumber}, improving clarity across ` +
            'multi-step technical onboarding, audit trails, and operator review tooling.',
          `Shipped evidence-heavy workflow narrative ${itemNumber} for highly technical users ` +
            'without dropping source-grounded proof points.',
        ],
        dateRange: `20${itemNumber.padStart(2, '0')} — Present`,
        employer: `Employer ${itemNumber}`,
        location: `Location ${itemNumber}`,
        roleTitle: `Role ${itemNumber}`,
      })
    }),
    kind: 'experience',
  }

  const document = createAdaptedCvDocument(longInput)

  expect(document.pageCount).toBeGreaterThan(3)
  expect(document.pageWarning).toContain(`${String(document.pageCount)} pages`)
  expect(document.html).toContain('Curriculum Vitae - Continued')
  expect(document.html).toContain('EXPERIENCE (CONTINUED)')
  expect(document.html).toContain('Role 1 · Employer 1')
  expect(document.html).toContain('Location 1 · 2001 — Present')
})

test('finishes a continued selected-work section before impact highlights begin', () => {
  const input = createAdaptedCvInput()

  input.adaptedCv.sections = [
    ...input.adaptedCv.sections,
    {
      items: Array.from({ length: 18 }, (_, index) => {
        return {
          text:
            `Selected work line ${String(index + 1)} with grounded workflow evidence for ` +
            'technical users and regulated review tooling.',
        }
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
  ]

  const document = createAdaptedCvDocument(input)
  const pageTwoMarkup = getPageMarkup(document.html, 2)
  const firstImpactHighlightsIndex = document.html.indexOf('IMPACT HIGHLIGHTS')
  const lastSelectedWorkContinuationIndex = document.html.lastIndexOf('SELECTED WORK (CONTINUED)')

  expect(document.pageCount).toBeGreaterThanOrEqual(3)
  expect(pageTwoMarkup).toContain('SELECTED WORK (CONTINUED)')
  expect(pageTwoMarkup).not.toContain('IMPACT HIGHLIGHTS')
  expect(firstImpactHighlightsIndex).toBeGreaterThan(lastSelectedWorkContinuationIndex)
})

test('builds safe readable export names and resolves overwrite collisions without silent replacement', async () => {
  const exportFilename = buildAdaptedCvExportFilename({
    candidateName: 'Ada Lovelace / Principal Designer',
    vacancyTitle: 'Senior platform engineer: growth & workflow',
  })

  expect(exportFilename).toBe(
    'Ada Lovelace Principal Designer - Senior platform engineer growth workflow - adapted-cv.pdf',
  )

  await expect(
    resolveUniqueExportFilePath(
      '/exports/Ada Lovelace - Senior platform engineer - adapted-cv.pdf',
      (candidatePath) => {
        return Promise.resolve(
          candidatePath === '/exports/Ada Lovelace - Senior platform engineer - adapted-cv.pdf' ||
            candidatePath ===
              '/exports/Ada Lovelace - Senior platform engineer - adapted-cv (2).pdf',
        )
      },
    ),
  ).resolves.toBe('/exports/Ada Lovelace - Senior platform engineer - adapted-cv (3).pdf')
})

function createExperienceEntry({
  bullets,
  dateRange,
  employer,
  location,
  roleTitle,
}: {
  bullets: string[]
  dateRange: string
  employer: string
  location: string | null
  roleTitle: string
}): AdaptedCvExperienceEntry {
  return {
    bullets: bullets.map((text) => {
      return {
        text,
      }
    }),
    dateRange,
    employer,
    location,
    roleTitle,
  }
}

function getPageMarkup(html: string, pageNumber: number): string {
  const startMarker = `<section class="cv-page page-${String(pageNumber)}">`
  const nextMarker = `<section class="cv-page page-${String(pageNumber + 1)}">`
  const startIndex = html.indexOf(startMarker)
  const nextIndex = html.indexOf(nextMarker)

  if (startIndex === -1) {
    throw new Error(`Expected page ${String(pageNumber)} to exist in the rendered document.`)
  }

  return nextIndex === -1 ? html.slice(startIndex) : html.slice(startIndex, nextIndex)
}
