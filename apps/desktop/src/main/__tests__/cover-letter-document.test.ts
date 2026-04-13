import { expect, test } from 'vitest'

import {
  buildCoverLetterPageWarning,
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

  expect(document.html).toContain('class="cover-letter-sheet"')
  expect(document.html).toContain('Ada Lovelace')
  expect(document.html).toContain('Senior platform engineer')
  expect(document.html).toContain('9 April 2026')
  expect(document.html).toContain('Dear Hiring Manager,')
  expect(document.html).toContain('I would welcome the chance to discuss')
  expect(document.html).not.toContain('Tailored for')
  expect(document.html).not.toContain('<p>Cover letter</p>')
  expect(document.html).not.toContain('PDF preview artifact')
})

test('builds a non-blocking warning only when the actual page count exceeds the threshold', () => {
  expect(buildCoverLetterPageWarning(1)).toBeNull()
  expect(buildCoverLetterPageWarning(2)).toBe(
    'This cover letter runs to 2 pages. Export and copy remain available.',
  )
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
