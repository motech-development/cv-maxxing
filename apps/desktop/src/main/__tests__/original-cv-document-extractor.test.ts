import { strToU8, zipSync } from 'fflate';
import { expect, test } from 'vitest';

import { extractTextFromDocx, extractTextFromPdf } from '../original-cv-document-extractor.js';

test('extracts readable text from PDF original CV files', async () => {
  const extractedDocument = await extractTextFromPdf(
    createPdfDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  expect(extractedDocument.pageCount).toBe(1);
  expect(extractedDocument.text).toContain('Ada Lovelace');
  expect(extractedDocument.text).toContain('Principal Product Designer');
  expect(extractedDocument.text).toContain('Product strategy, UX research, prototyping');
});

test('extracts readable text from DOCX original CV files', async () => {
  const extractedDocument = await extractTextFromDocx(
    createDocxDocumentBuffer([
      'Ada Lovelace',
      'Principal Product Designer',
      'Summary',
      'Design leader focused on complex workflow products.',
      'Experience',
      'Principal Product Designer | Analytical Engines Ltd',
      'Skills',
      'Product strategy, UX research, prototyping',
    ]),
  );

  expect(extractedDocument.pageCount).toBe(0);
  expect(extractedDocument.text).toContain('Ada Lovelace');
  expect(extractedDocument.text).toContain('Principal Product Designer');
  expect(extractedDocument.text).toContain('Product strategy, UX research, prototyping');
});

test('extracts DOCX page count from extended document properties', async () => {
  const extractedDocument = await extractTextFromDocx(
    createDocxDocumentBuffer(
      [
        'Ada Lovelace',
        'Principal Product Designer',
        'Summary',
        'Design leader focused on complex workflow products.',
      ],
      {
        pageCount: 3,
      },
    ),
  );

  expect(extractedDocument.pageCount).toBe(3);
  expect(extractedDocument.text).toContain('Ada Lovelace');
});

function createDocxDocumentBuffer(
  lines: string[],
  options: {
    pageCount?: number;
  } = {},
): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        ${lines
          .map((line) => {
            return `<w:p><w:r><w:t>${escapeXmlText(line)}</w:t></w:r></w:p>`;
          })
          .join('')}
      </w:body>
    </w:document>`;
  const appPropertiesXml =
    options.pageCount === undefined
      ? undefined
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Pages>${String(options.pageCount)}</Pages>
</Properties>`;
  const archiveEntries = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
  ${
    appPropertiesXml === undefined
      ? ''
      : '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />'
  }
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
</Relationships>`),
    'word/document.xml': strToU8(documentXml),
    ...(appPropertiesXml === undefined
      ? {}
      : {
          'docProps/app.xml': strToU8(appPropertiesXml),
        }),
  };

  return Buffer.from(zipSync(archiveEntries));
}

function createPdfDocumentBuffer(lines: string[]): Buffer {
  const contentStream = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    ...lines.flatMap((line, index) => {
      const command = `(${escapePdfText(line)}) Tj`;

      if (index === 0) {
        return [command];
      }

      return ['0 -18 Td', command];
    }),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${String(Buffer.byteLength(contentStream, 'utf8'))} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');

  pdf += `xref
0 ${String(objects.length + 1)}
0000000000 65535 f 
${offsets
  .slice(1)
  .map((offset) => {
    return `${String(offset).padStart(10, '0')} 00000 n `;
  })
  .join('\n')}
trailer
<< /Size ${String(objects.length + 1)} /Root 1 0 R >>
startxref
${String(xrefOffset)}
%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('(', String.raw`\(`)
    .replaceAll(')', String.raw`\)`);
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
