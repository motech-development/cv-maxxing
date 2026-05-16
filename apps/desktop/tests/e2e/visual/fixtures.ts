import { strToU8, zipSync } from 'fflate'

export interface GenerationFixtureOverrides {
  coverLetter?: Partial<{
    body: {
      text: string
    }[]
    closing: {
      text: string
    }
    date: string
    greeting: string
    opening: {
      text: string
    }
    signature: string
  }>
}

export interface VacancyNormalizationFixtureOverrides {
  bodyText?: string
  employer?: string | null
  location?: string | null
  requirements?: string[]
  responsibilities?: string[]
  title?: string | null
}

export function createBaseOriginalCvLines(): string[] {
  return [
    'Ada Lovelace',
    'Principal Product Designer',
    'Summary',
    'Design leader focused on complex workflow products for technical users.',
    'Experience',
    'Principal Product Designer | Analytical Engines Ltd',
    'Led product design for AI-assisted desktop tooling.',
    'Skills',
    'Product strategy, UX research, prototyping',
  ]
}

export function createPastedVacancyFixture(): string {
  return [
    'Senior platform engineer',
    'Example Labs',
    'London, United Kingdom',
    '',
    'Responsibilities',
    '- Build reliable desktop tooling for technical users.',
    '- Partner with design and infrastructure teams.',
    '',
    'Requirements',
    '- Experience shipping workflow software.',
    '- Strong written communication.',
  ].join('\n')
}

export function createEditableDraftVacancyFixture(): string {
  return [
    'Staff platform designer',
    'North Star Systems',
    'Bristol, United Kingdom',
    '',
    'Responsibilities',
    '- Shape desktop workflow tooling for technical teams.',
    '- Improve handoff quality between product design and engineering.',
    '',
    'Requirements',
    '- Strong systems thinking.',
    '- Experience with desktop workflow software.',
  ].join('\n')
}

export function createGenerationResultFixture(overrides?: GenerationFixtureOverrides) {
  const baseFixture = {
    adaptationSummary: {
      emphasized: [
        {
          text: 'Emphasises desktop workflow design for technical users.',
        },
      ],
      gaps: [
        'The vacancy asks for workflow-software shipping experience; the original CV shows related desktop-tooling design work but does not claim engineering ownership.',
      ],
      omitted: [
        {
          text: 'Compresses broader research language so the desktop-tooling evidence stays primary.',
        },
      ],
      validationHints: ['Keep interview examples grounded in shipped desktop workflow tooling.'],
    },
    adaptedCv: {
      candidateName: 'Ada Lovelace',
      certifications: null,
      coreSkills: {
        items: [
          {
            text: 'Product strategy',
          },
          {
            text: 'UX research',
          },
        ],
      },
      education: null,
      experience: {
        items: [
          {
            bullets: [
              {
                text: 'Led product design for AI-assisted desktop tooling used by technical teams.',
              },
            ],
            dateRange: '2022 — Present',
            employer: 'Analytical Engines Ltd',
            location: 'London',
            roleTitle: 'Principal Product Designer',
          },
        ],
      },
      focus: null,
      header: {
        intro: {
          text: 'Design leader shaping truthful desktop workflow products for technical users.',
        },
      },
      headline: {
        text: 'Principal Product Designer',
      },
      impactHighlights: null,
      languages: null,
      profile: {
        summary: {
          text: 'Design leader adapting complex desktop workflow products for technical users.',
        },
      },
      references: {
        kind: 'references',
      },
      selectedWork: null,
      tools: null,
    },
    coverLetter: {
      body: [
        {
          text: 'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        },
      ],
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support Analytical Engines Ltd.',
      },
      date: '9 April 2026',
      greeting: 'Dear Hiring Manager,',
      opening: {
        text: 'I am applying for the Senior platform engineer role at Analytical Engines Ltd.',
      },
      signature: 'Ada Lovelace',
    },
    trace: {
      model: 'gpt-5.4-codex',
      provider: 'codex',
      sessionId: 'session-123',
    },
  }
  const coverLetter = {
    ...baseFixture.coverLetter,
    ...overrides?.coverLetter,
  }

  return {
    ...baseFixture,
    coverLetter,
  }
}

export function createMultiPageGenerationResultFixture() {
  const coverLetterBody = Array.from({ length: 18 }, () => {
    return {
      text: 'I have repeatedly led product design for demanding desktop workflow environments, aligning technical users, operating constraints, and truthful communication so the resulting tools remained reliable, teachable, and useful in daily work across long-running programmes and cross-functional delivery cycles.',
    }
  })

  return createGenerationResultFixture({
    coverLetter: {
      body: coverLetterBody,
      closing: {
        text: 'I would welcome the chance to discuss how that experience could support reliable tooling for technical users at Analytical Engines Ltd.',
      },
    },
  })
}

export function createVacancyNormalizationFixtureOutput(
  overrides: VacancyNormalizationFixtureOverrides = {},
): string {
  const normalizedVacancy = {
    bodyText:
      overrides.bodyText ??
      'Build reliable desktop tooling for technical users. Partner with design and infrastructure teams. Experience shipping workflow software. Strong written communication.',
    employer: overrides.employer ?? 'Example Labs',
    location: overrides.location ?? 'London, United Kingdom',
    requirements: overrides.requirements ?? [
      'Experience shipping workflow software.',
      'Strong written communication.',
    ],
    responsibilities: overrides.responsibilities ?? [
      'Build reliable desktop tooling for technical users.',
      'Partner with design and infrastructure teams.',
    ],
    title: overrides.title ?? 'Senior platform engineer',
  }

  return JSON.stringify({
    kind: 'success',
    normalizedVacancy,
  })
}

export function createDocxDocumentBuffer(lines: string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${lines
      .map((line) => {
        return `<w:p><w:r><w:t>${escapeXmlText(line)}</w:t></w:r></w:p>`
      })
      .join('')}
  </w:body>
</w:document>`

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
</Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
</Relationships>`),
      'word/document.xml': strToU8(documentXml),
    }),
  )
}

export function createPdfDocumentBuffer(lines: string[]): Buffer {
  const contentStream = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    ...lines.flatMap((line, index) => {
      const command = `(${escapePdfText(line)}) Tj`

      if (index === 0) {
        return [command]
      }

      return ['0 -18 Td', command]
    }),
    'ET',
  ].join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${String(Buffer.byteLength(contentStream, 'utf8'))} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')

  pdf += `xref
0 ${String(objects.length + 1)}
0000000000 65535 f 
${offsets
  .slice(1)
  .map((offset) => {
    return `${String(offset).padStart(10, '0')} 00000 n `
  })
  .join('\n')}
trailer
<< /Size ${String(objects.length + 1)} /Root 1 0 R >>
startxref
${String(xrefOffset)}
%%EOF`

  return Buffer.from(pdf, 'utf8')
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`)
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
