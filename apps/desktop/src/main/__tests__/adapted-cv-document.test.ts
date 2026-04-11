import { expect, test } from 'vitest'

import {
  buildAdaptedCvExportFilename,
  createAdaptedCvDocument,
  resolveUniqueExportFilePath,
} from '../adapted-cv-document.js'
import type { AdaptedCvModel } from '../../shared/tailored-application.js'

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
            {
              bullets: [
                {
                  text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
                },
              ],
              heading: 'Analytical Engines Ltd',
            },
            {
              bullets: [
                {
                  text: 'Partnered with engineering on complex workflow software for regulated users.',
                },
              ],
              heading: 'Difference Engines Studio',
            },
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

test('creates continued headers and a non-blocking warning when pagination exceeds the v1 threshold', () => {
  const longInput = createAdaptedCvInput()

  longInput.adaptedCv.sections[1] = {
    items: Array.from({ length: 18 }, (_, index) => {
      const itemNumber = String(index + 1)

      return {
        bullets: [
          {
            text:
              `Owned complex desktop workflow redesign ${itemNumber}, improving clarity across ` +
              'multi-step technical onboarding, audit trails, and operator review tooling.',
          },
          {
            text:
              `Shipped evidence-heavy workflow narrative ${itemNumber} for highly technical users ` +
              'without dropping source-grounded proof points.',
          },
        ],
        heading: `Experience heading ${itemNumber}`,
      }
    }),
    kind: 'experience',
  }

  const document = createAdaptedCvDocument(longInput)

  expect(document.pageCount).toBeGreaterThan(3)
  expect(document.pageWarning).toContain(`${String(document.pageCount)} pages`)
  expect(document.html).toContain('Curriculum Vitae - Continued')
  expect(document.html).toContain('EXPERIENCE (CONTINUED)')
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
