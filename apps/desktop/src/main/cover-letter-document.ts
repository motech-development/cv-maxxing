import type { CoverLetterModel } from '../shared/tailored-application.js'
export { resolveUniqueExportFilePath } from './adapted-cv-document.js'

const PAGE_WARNING_THRESHOLD = 1
const FIRST_PAGE_CAPACITY = 42
const CONTINUED_PAGE_CAPACITY = 46
const SAFE_FILENAME_CHARACTER = /[^a-z0-9]+/giu

interface CoverLetterDocumentInput {
  coverLetter: CoverLetterModel
  employer: string | null
  vacancyTitle: string | null
}

interface CoverLetterPage {
  blocks: CoverLetterBlock[]
  kind: 'continued' | 'main'
}

type CoverLetterBlock =
  | {
      kind: 'body' | 'closing' | 'opening'
      text: string
    }
  | {
      kind: 'date' | 'greeting' | 'signature'
      text: string
    }

export interface CoverLetterDocument {
  html: string
  pageCount: number
  pageWarning: string | null
}

export function createCoverLetterDocument(input: CoverLetterDocumentInput): CoverLetterDocument {
  const pages = paginateCoverLetter(input.coverLetter)

  return {
    html: buildDocumentHtml({
      employer: input.employer,
      pages,
      title: input.coverLetter.signature,
      vacancyTitle: input.vacancyTitle,
    }),
    pageCount: pages.length,
    pageWarning: pages.length > PAGE_WARNING_THRESHOLD ? buildPageWarning(pages.length) : null,
  }
}

export function buildCoverLetterExportFilename({
  candidateName,
  vacancyTitle,
}: {
  candidateName: string
  vacancyTitle: string | null
}): string {
  const safeCandidateName = sanitizeFilenamePart(candidateName)
  const safeVacancyTitle = sanitizeFilenamePart(vacancyTitle ?? 'cover letter')

  return `${safeCandidateName} - ${safeVacancyTitle} - cover-letter.pdf`
}

function paginateCoverLetter(coverLetter: CoverLetterModel): CoverLetterPage[] {
  const remainingBlocks: CoverLetterBlock[] = [
    {
      kind: 'date',
      text: coverLetter.date,
    },
    {
      kind: 'greeting',
      text: coverLetter.greeting,
    },
    {
      kind: 'opening',
      text: coverLetter.opening.text,
    },
    ...coverLetter.body.map((paragraph) => {
      return {
        kind: 'body' as const,
        text: paragraph.text,
      }
    }),
    {
      kind: 'closing',
      text: coverLetter.closing.text,
    },
    {
      kind: 'signature',
      text: coverLetter.signature,
    },
  ]
  const pages: CoverLetterPage[] = []
  let currentCapacity = FIRST_PAGE_CAPACITY
  let currentPage: CoverLetterPage = {
    blocks: [],
    kind: 'main',
  }

  while (remainingBlocks.length > 0) {
    const nextBlock = remainingBlocks[0]

    if (nextBlock === undefined) {
      break
    }

    const nextBlockHeight = estimateBlockHeight(nextBlock)

    if (currentPage.blocks.length > 0 && nextBlockHeight > currentCapacity) {
      pages.push(currentPage)
      currentPage = {
        blocks: [],
        kind: 'continued',
      }
      currentCapacity = CONTINUED_PAGE_CAPACITY

      continue
    }

    currentPage.blocks.push(nextBlock)
    remainingBlocks.shift()
    currentCapacity -= nextBlockHeight
  }

  if (currentPage.blocks.length > 0) {
    pages.push(currentPage)
  }

  return pages
}

function estimateBlockHeight(block: CoverLetterBlock): number {
  if (block.kind === 'date' || block.kind === 'greeting' || block.kind === 'signature') {
    return 3
  }

  if (block.kind === 'closing') {
    return 4 + Math.ceil(block.text.length / 150)
  }

  return 4 + Math.ceil(block.text.length / 135)
}

function buildDocumentHtml({
  employer,
  pages,
  title,
  vacancyTitle,
}: {
  employer: string | null
  pages: CoverLetterPage[]
  title: string
  vacancyTitle: string | null
}): string {
  const pageMarkup = pages
    .map((page, index) => {
      return page.kind === 'main'
        ? buildMainPageMarkup({
            employer,
            page,
            title,
            vacancyTitle,
          })
        : buildContinuedPageMarkup({
            employer,
            page,
            pageNumber: index + 1,
            title,
            vacancyTitle,
          })
    })
    .join('')

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Cover letter</title>',
    '<style>',
    buildDocumentStyles(),
    '</style>',
    '</head>',
    '<body>',
    '<main class="cover-letter-document">',
    pageMarkup,
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}

function buildMainPageMarkup({
  employer,
  page,
  title,
  vacancyTitle,
}: {
  employer: string | null
  page: CoverLetterPage
  title: string
  vacancyTitle: string | null
}): string {
  return [
    '<section class="cover-letter-page page-1">',
    '<header class="header-main">',
    '<section class="identity-main">',
    `<h1 class="name-main">${escapeHtml(title)}</h1>`,
    `<p class="role-main">${escapeHtml(vacancyTitle ?? 'Cover letter')}</p>`,
    `<p class="intro-main">${escapeHtml(buildSubtitleLabel(employer, vacancyTitle))}</p>`,
    '</section>',
    '<section class="contact-list">',
    '<p>Cover letter</p>',
    '<p>PDF preview artifact</p>',
    '</section>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="body-main">',
    buildBlocksMarkup(page.blocks),
    '</section>',
    '</section>',
  ].join('')
}

function buildContinuedPageMarkup({
  employer,
  page,
  pageNumber,
  title,
  vacancyTitle,
}: {
  employer: string | null
  page: CoverLetterPage
  pageNumber: number
  title: string
  vacancyTitle: string | null
}): string {
  return [
    `<section class="cover-letter-page page-${String(pageNumber)}">`,
    '<header class="header-continued">',
    `<p class="name-continued">${escapeHtml(title)}</p>`,
    `<p class="role-continued">${escapeHtml(vacancyTitle ?? employer ?? 'Cover letter')}</p>`,
    '<p class="intro-continued">Cover letter - Continued</p>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="body-continued">',
    buildBlocksMarkup(page.blocks),
    '</section>',
    '</section>',
  ].join('')
}

function buildBlocksMarkup(blocks: CoverLetterBlock[]): string {
  return blocks
    .map((block) => {
      let className = 'letter-paragraph'

      switch (block.kind) {
        case 'date': {
          className = 'letter-date'
          break
        }
        case 'greeting': {
          className = 'letter-greeting'
          break
        }
        case 'signature': {
          className = 'letter-signature'
          break
        }
        default: {
          break
        }
      }

      return `<p class="${className}">${escapeHtml(block.text)}</p>`
    })
    .join('')
}

function buildSubtitleLabel(employer: string | null, vacancyTitle: string | null): string {
  const summaryBits = [vacancyTitle, employer].filter((value): value is string => {
    return value !== null && value.trim() !== ''
  })

  if (summaryBits.length === 0) {
    return 'Tailored for the selected job vacancy.'
  }

  return `Tailored for ${summaryBits.join(' · ')}.`
}

function buildPageWarning(pageCount: number): string {
  return `This cover letter runs to ${String(pageCount)} pages. Export and copy remain available.`
}

function sanitizeFilenamePart(value: string): string {
  const collapsedWhitespace = value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(SAFE_FILENAME_CHARACTER, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')

  return collapsedWhitespace === '' ? 'cover-letter' : collapsedWhitespace
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildDocumentStyles(): string {
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

    * {
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
    p {
      margin: 0;
    }

    .cover-letter-page {
      width: 794px;
      height: 1123px;
      margin: 0 auto;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      break-after: page;
      page-break-after: always;
    }

    .cover-letter-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .page-1 {
      gap: 34px;
      padding: 52px 58px;
    }

    .page-2,
    .page-3,
    .page-4 {
      gap: 24px;
      padding: 36px 58px 52px;
    }

    .header-main {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
    }

    .identity-main {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      padding-bottom: 2px;
    }

    .name-main {
      color: var(--text-primary);
      font-size: 44px;
      font-weight: 600;
      letter-spacing: 0.4px;
      line-height: normal;
    }

    .role-main {
      color: var(--text-muted);
      font-size: 20px;
      font-weight: 500;
      line-height: normal;
    }

    .intro-main {
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 400;
      line-height: 1.45;
      width: 430px;
    }

    .contact-list {
      align-items: flex-end;
      display: flex;
      flex: 0 0 250px;
      flex-direction: column;
      gap: 6px;
      width: 250px;
    }

    .contact-list p {
      color: var(--text-primary);
      font-size: 12px;
      font-weight: 400;
      line-height: normal;
      text-align: right;
    }

    .divider {
      background: transparent;
      border-top: 1px solid var(--divider);
      height: 0;
      width: 100%;
    }

    .body-main,
    .body-continued {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 16px;
      min-height: 0;
    }

    .header-continued {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .name-continued {
      color: var(--text-primary);
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 0.2px;
      line-height: normal;
    }

    .role-continued,
    .intro-continued {
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      line-height: normal;
    }

    .letter-date,
    .letter-greeting,
    .letter-signature {
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.6;
    }

    .letter-paragraph {
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 400;
      line-height: 1.75;
    }

    .letter-signature {
      padding-top: 6px;
    }
  `
}
