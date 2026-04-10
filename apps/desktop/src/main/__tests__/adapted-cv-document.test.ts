import { expect, test } from 'vitest'

import {
  buildAdaptedCvExportFilename,
  createAdaptedCvDocument,
  resolveUniqueExportFilePath,
} from '../adapted-cv-document.js'

function createAdaptedCvInput() {
  return {
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      experienceHighlights: [
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
      headline: {
        text: 'Principal Product Designer for desktop workflow products',
      },
      skills: [
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
      summary: {
        text: 'Design leader adapting complex desktop workflow products for technical users.',
      },
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
  expect(document.html).toContain('PROFILE')
  expect(document.html).toContain('EXPERIENCE')
  expect(document.html).toContain('CORE SKILLS')
  expect(document.html).not.toContain('(CONTINUED)')
})

test('creates continued headers and a non-blocking warning when pagination exceeds the v1 threshold', () => {
  const longInput = createAdaptedCvInput()

  longInput.adaptedCv.experienceHighlights = Array.from({ length: 18 }, (_, index) => {
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
  })

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
