import { expect, test } from 'vitest'

import {
  buildCoverLetterExportFilename,
  createCoverLetterDocument,
  resolveUniqueExportFilePath,
} from '../cover-letter-document.js'

function createCoverLetterInput() {
  return {
    coverLetter: {
      body: [
        {
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support Example Labs.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        text: 'I am applying for the Senior platform engineer role at Example Labs.',
      },
      signature: 'Ada Lovelace',
    },
    employer: 'Example Labs',
    vacancyTitle: 'Senior platform engineer',
  }
}

test('renders a single-page cover-letter document using the shared PDF visual system', () => {
  const document = createCoverLetterDocument(createCoverLetterInput())

  expect(document.pageCount).toBe(1)
  expect(document.pageWarning).toBeNull()
  expect(document.html).toContain('class="cover-letter-page page-1"')
  expect(document.html).toContain('Ada Lovelace')
  expect(document.html).toContain('Cover letter')
  expect(document.html).toContain('9 April 2026')
  expect(document.html).toContain('Dear Hiring Manager,')
  expect(document.html).toContain('I would welcome the chance to discuss')
})

test('adds a non-blocking warning when the cover letter spills to continued pages', () => {
  const longInput = createCoverLetterInput()

  longInput.coverLetter.body = Array.from({ length: 12 }, (_, index) => {
    const itemNumber = String(index + 1)

    return {
      text:
        `Paragraph ${itemNumber} explains grounded desktop-tooling evidence in detail, ` +
        'preserving a truthful connection between the original CV and the vacancy requirements.',
    }
  })

  const document = createCoverLetterDocument(longInput)

  expect(document.pageCount).toBeGreaterThan(1)
  expect(document.pageWarning).toBe(
    `This cover letter runs to ${String(document.pageCount)} pages. Export and copy remain available.`,
  )
  expect(document.html).toContain('Cover letter - Continued')
})

test('builds safe readable cover-letter export names and resolves overwrite collisions', async () => {
  const exportFilename = buildCoverLetterExportFilename({
    candidateName: 'Ada Lovelace / Principal Designer',
    vacancyTitle: 'Senior platform engineer: growth & workflow',
  })

  expect(exportFilename).toBe(
    'Ada Lovelace Principal Designer - Senior platform engineer growth workflow - cover-letter.pdf',
  )

  await expect(
    resolveUniqueExportFilePath(
      '/exports/Ada Lovelace - Senior platform engineer - cover-letter.pdf',
      (candidatePath) => {
        return Promise.resolve(
          candidatePath === '/exports/Ada Lovelace - Senior platform engineer - cover-letter.pdf' ||
            candidatePath ===
              '/exports/Ada Lovelace - Senior platform engineer - cover-letter (2).pdf',
        )
      },
    ),
  ).resolves.toBe('/exports/Ada Lovelace - Senior platform engineer - cover-letter (3).pdf')
})
