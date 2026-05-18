import { strFromU8, unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedDocumentText {
  pageCount: number;
  text: string;
}

export async function extractTextFromPdf(content: Buffer): Promise<ExtractedDocumentText> {
  const pdfDocument = await getDocument(new Uint8Array(content)).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lineItems = textContent.items.flatMap((item) => {
      if (!('str' in item) || !('transform' in item) || !Array.isArray(item.transform)) {
        return [];
      }

      const text = typeof item.str === 'string' ? item.str.trim() : '';
      const x = typeof item.transform[4] === 'number' ? item.transform[4] : 0;
      const y = typeof item.transform[5] === 'number' ? item.transform[5] : 0;

      return [
        {
          text,
          x,
          y,
        },
      ];
    });
    const groupedLineItems = new Map<number, typeof lineItems>();

    for (const lineItem of lineItems) {
      if (lineItem.text === '') {
        continue;
      }

      const rowKey = Math.round(lineItem.y);
      const existingLineItems = groupedLineItems.get(rowKey) ?? [];

      existingLineItems.push(lineItem);
      groupedLineItems.set(rowKey, existingLineItems);
    }

    const pageText = [...groupedLineItems.entries()]
      .toSorted((leftEntry, rightEntry) => {
        return rightEntry[0] - leftEntry[0];
      })
      .map(([, items]) => {
        return items
          .toSorted((leftItem, rightItem) => {
            return leftItem.x - rightItem.x;
          })
          .map((item) => {
            return item.text;
          })
          .join(' ')
          .replaceAll(/\s+/gu, ' ')
          .trim();
      })
      .filter((line) => {
        return line !== '';
      })
      .join('\n');

    pageTexts.push(pageText);
  }

  return {
    pageCount: pdfDocument.numPages,
    text: pageTexts
      .filter((pageText) => {
        return pageText !== '';
      })
      .join('\n'),
  };
}

export function extractTextFromDocx(content: Buffer): Promise<ExtractedDocumentText> {
  const archiveEntries = unzipSync(new Uint8Array(content));
  const documentXml = archiveEntries['word/document.xml'];
  const pageCount = readDocxExtendedPropertiesPageCount(archiveEntries);

  if (documentXml === undefined) {
    return Promise.resolve({
      pageCount: 0,
      text: '',
    });
  }

  const rawXml = strFromU8(documentXml);
  const text = decodeXmlText(
    rawXml
      .replaceAll('<w:tab/>', ' ')
      .replaceAll('</w:p>', '\n')
      .replaceAll(/<[^>]+>/gu, '')
      .replaceAll(/\n+/gu, '\n')
      .trim(),
  );

  return Promise.resolve({
    pageCount: text === '' ? 0 : pageCount,
    text,
  });
}

function readDocxExtendedPropertiesPageCount(archiveEntries: Record<string, Uint8Array>) {
  const appPropertiesXml = archiveEntries['docProps/app.xml'];

  if (appPropertiesXml === undefined) {
    return 0;
  }

  const matchedPages = /<Pages>(\d+)<\/Pages>/u.exec(strFromU8(appPropertiesXml));
  const parsedPageCount = Number.parseInt(matchedPages?.[1] ?? '', 10);

  if (!Number.isSafeInteger(parsedPageCount) || parsedPageCount <= 0) {
    return 0;
  }

  return parsedPageCount;
}

function decodeXmlText(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}
