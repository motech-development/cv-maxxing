import type { CoverLetterModel } from '../shared/tailored-application.js';

export { resolveUniqueExportFilePath } from './adapted-cv-document.js';

const PAGE_WARNING_THRESHOLD = 1;
const SAFE_FILENAME_CHARACTER = /[^a-z0-9]+/giu;

interface CoverLetterDocumentInput {
  coverLetter: CoverLetterModel;
  employer: string | null;
  vacancyTitle: string | null;
}

interface CoverLetterExportFilenameInput {
  candidateName: string;
  vacancyTitle: string | null;
}

type CoverLetterBlock =
  | {
      kind: 'body' | 'closing' | 'opening';
      text: string;
    }
  | {
      kind: 'date' | 'greeting' | 'signature';
      text: string;
    };

export interface CoverLetterDocument {
  html: string;
}

export function createCoverLetterDocument(input: CoverLetterDocumentInput): CoverLetterDocument {
  const documentTitle = buildDocumentTitle({
    employer: input.employer,
    vacancyTitle: input.vacancyTitle,
  });

  return {
    html: buildDocumentHtml({
      blocks: buildBlocks(input.coverLetter),
      documentTitle,
      title: input.coverLetter.signature,
    }),
  };
}

export function buildCoverLetterPageWarning(pageCount: number): string | null {
  if (pageCount > PAGE_WARNING_THRESHOLD) {
    return `This cover letter runs to ${String(pageCount)} pages. Export and copy remain available.`;
  }

  return null;
}

export function buildCoverLetterExportFilename({
  candidateName,
  vacancyTitle,
}: CoverLetterExportFilenameInput) {
  const safeCandidateName = sanitizeFilenamePart(candidateName);
  const safeVacancyTitle = sanitizeFilenamePart(vacancyTitle ?? 'cover letter');

  return `${safeCandidateName} - ${safeVacancyTitle} - cover-letter.pdf`;
}

function buildBlocks(coverLetter: CoverLetterModel): CoverLetterBlock[] {
  return [
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
      };
    }),
    {
      kind: 'closing',
      text: coverLetter.closing.text,
    },
    {
      kind: 'signature',
      text: coverLetter.signature,
    },
  ];
}

function buildDocumentTitle({
  employer,
  vacancyTitle,
}: {
  employer: string | null;
  vacancyTitle: string | null;
}): string | null {
  if (vacancyTitle !== null && vacancyTitle.trim() !== '') {
    return vacancyTitle;
  }

  if (employer !== null && employer.trim() !== '') {
    return employer;
  }

  return null;
}

function buildDocumentHtml({
  blocks,
  documentTitle,
  title,
}: {
  blocks: CoverLetterBlock[];
  documentTitle: string | null;
  title: string;
}) {
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
    '<section class="cover-letter-sheet">',
    '<header class="cover-letter-header">',
    '<section class="identity-main">',
    `<h1 class="name-main">${escapeHtml(title)}</h1>`,
    documentTitle === null ? '' : `<p class="role-main">${escapeHtml(documentTitle)}</p>`,
    '</section>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="cover-letter-body">',
    buildBlocksMarkup(blocks),
    '</section>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}

function buildBlocksMarkup(blocks: CoverLetterBlock[]) {
  return blocks
    .map((block) => {
      let className = 'letter-paragraph';

      switch (block.kind) {
        case 'date': {
          className = 'letter-date';
          break;
        }
        case 'greeting': {
          className = 'letter-greeting';
          break;
        }
        case 'signature': {
          className = 'letter-signature';
          break;
        }
        default: {
          break;
        }
      }

      return `<p class="${className}">${escapeHtml(block.text)}</p>`;
    })
    .join('');
}

function sanitizeFilenamePart(value: string) {
  const collapsedWhitespace = value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(SAFE_FILENAME_CHARACTER, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ');

  return collapsedWhitespace === '' ? 'cover-letter' : collapsedWhitespace;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildDocumentStyles() {
  return `
    :root {
      --bg: #ffffff;
      --text-primary: #1e2428;
      --text-muted: #5e6872;
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

    .cover-letter-document {
      width: 794px;
      margin: 0 auto;
      background: var(--bg);
    }

    .cover-letter-sheet {
      display: flex;
      flex-direction: column;
      gap: 26px;
      padding: 42px 58px 48px;
    }

    .cover-letter-header {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .identity-main {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
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
      line-height: 1.4;
    }

    .divider {
      background: transparent;
      border-top: 1px solid var(--divider);
      height: 0;
      width: 100%;
    }

    .cover-letter-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .letter-date,
    .letter-greeting,
    .letter-signature {
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.6;
    }

    .letter-date,
    .letter-greeting {
      break-after: avoid;
      page-break-after: avoid;
    }

    .letter-paragraph {
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 400;
      line-height: 1.75;
      orphans: 3;
      widows: 3;
    }

    .letter-signature {
      padding-top: 6px;
    }
  `;
}
