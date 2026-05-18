// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { OriginalCvDetail } from '../../../shared/original-cv.js';
import { createRuntimeAlert } from '../../runtime-alerts.js';

const originalCvPreviewCardProperties = vi.hoisted(() => {
  return {
    lastProperties: null as Record<string, unknown> | null,
  };
});

vi.mock('../../ui/original-cv-preview-card.js', () => {
  return {
    OriginalCvPreviewCard: (properties: Record<string, unknown>) => {
      originalCvPreviewCardProperties.lastProperties = properties;

      return <div aria-label="Rendered original CV preview">Original CV preview</div>;
    },
  };
});

import { OriginalCvScreen } from '../original-cv-screen.js';

afterEach(() => {
  cleanup();
});

function findPanelCard(element: HTMLElement | null): HTMLElement | null {
  let currentElement = element;

  while (currentElement !== null) {
    if (currentElement.className.includes('rounded-[var(--radius-card)]')) {
      return currentElement;
    }

    currentElement = currentElement.parentElement;
  }

  return null;
}

function createOriginalCvDetailFixture(
  overrides: Partial<OriginalCvDetail> = {},
): OriginalCvDetail {
  return {
    originalCv: {
      fileType: 'pdf',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 2,
      snapshotCount: 1,
      summary: 'Design leader focused on complex workflow products.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    preview: {
      kind: 'pdf',
      pageCount: 2,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    profile: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [
        {
          dateRange: '2022 - Present',
          employer: 'Analytical Engines Ltd',
          roleTitle: 'Principal Product Designer',
          summary: 'Led product design for AI-assisted desktop tooling.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Product strategy'],
      summary: 'Design leader focused on complex workflow products.',
    },
    ...overrides,
  };
}

test('renders the populated Your CV screen with a selectable sidebar item, PDF preview, and scrollable extracted profile', () => {
  const onSelectOriginalCv = vi.fn();

  render(
    <OriginalCvScreen
      activeOriginalCv={createOriginalCvDetailFixture().originalCv}
      activeOriginalCvDetail={createOriginalCvDetailFixture()}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={onSelectOriginalCv}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  expect(screen.getByRole('button', { name: 'Open your CV' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Open your CV' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(screen.getAllByRole('heading', { name: 'Your CV' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Extracted profile').length).toBeGreaterThan(0);
  expect(screen.getByText('ada@lovelace.dev')).toBeDefined();
  expect(screen.getByText('Workflow design')).toBeDefined();
  expect(screen.getByText(/Analytical Engines Ltd/u)).toBeDefined();
  expect(screen.queryByText('Ada Lovelace')).toBeNull();
  expect(screen.getByLabelText('Rendered original CV preview')).toBeDefined();

  const profilePanel = screen.getByText('Extracted profile').closest('section');

  expect(profilePanel).not.toBeNull();
  expect(profilePanel?.className).toContain('overflow-y-auto');

  expect(originalCvPreviewCardProperties.lastProperties).toMatchObject({
    emptyStateCopy: 'Your CV preview will appear here.',
    preview: {
      kind: 'pdf',
      pageCount: 2,
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
    },
    title: 'Your CV',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Open your CV' }));

  expect(onSelectOriginalCv).toHaveBeenCalledTimes(1);
});

test('uses the same populated Your CV preview pane for DOCX original CVs', () => {
  const onSelectOriginalCv = vi.fn();

  render(
    <OriginalCvScreen
      activeOriginalCv={{
        ...createOriginalCvDetailFixture().originalCv,
        fileType: 'docx',
        originalFilename: 'ada-lovelace-revised.docx',
      }}
      activeOriginalCvDetail={createOriginalCvDetailFixture({
        originalCv: {
          ...createOriginalCvDetailFixture().originalCv,
          fileType: 'docx',
          originalFilename: 'ada-lovelace-revised.docx',
        },
        preview: {
          docxBytes: new Uint8Array([80, 75, 3, 4]),
          kind: 'docx',
        },
      })}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={onSelectOriginalCv}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  expect(screen.getAllByRole('heading', { name: 'Your CV' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Extracted profile').length).toBeGreaterThan(0);
  expect(screen.queryByText('Previews are only available for PDF uploads.')).toBeNull();
  expect(originalCvPreviewCardProperties.lastProperties).toMatchObject({
    emptyStateCopy: 'Your CV preview will appear here.',
    preview: {
      docxBytes: new Uint8Array([80, 75, 3, 4]),
      kind: 'docx',
    },
    title: 'Your CV',
  });
});

test('shows unavailable page-count copy when a DOCX does not report page metadata', () => {
  const originalCv = {
    ...createOriginalCvDetailFixture().originalCv,
    fileType: 'docx' as const,
    originalFilename: 'ada-lovelace-revised.docx',
    pageCount: 0,
  };

  render(
    <OriginalCvScreen
      activeOriginalCv={originalCv}
      activeOriginalCvDetail={createOriginalCvDetailFixture({
        originalCv,
        preview: {
          docxBytes: new Uint8Array([80, 75, 3, 4]),
          kind: 'docx',
        },
      })}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  expect(screen.getAllByText(/Page count unavailable/u).length).toBeGreaterThan(0);
});

test('renders the populated add-a-cv replacement view from design/app.pen', () => {
  render(
    <OriginalCvScreen
      activeOriginalCv={createOriginalCvDetailFixture().originalCv}
      activeOriginalCvDetail={createOriginalCvDetailFixture()}
      activeView="replace"
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  expect(
    screen.getByRole('button', { name: 'Open your CV' }).getAttribute('aria-current'),
  ).toBeNull();
  expect(screen.getByRole('heading', { name: 'Add a CV' })).toBeDefined();
  expect(
    screen.getByText(
      "Choose the PDF or DOCX copy of your CV you'd like to use from now on. Your saved jobs won't change.",
    ),
  ).toBeDefined();
  expect(
    screen.getByText("Replacing your CV changes the one you'll use for new jobs."),
  ).toBeDefined();
  expect(
    screen.getByText("Your saved jobs keep the CV and cover letter you've already made."),
  ).toBeDefined();
  expect(
    screen.getByText("We'll use this CV for new jobs. Your saved jobs stay the same."),
  ).toBeDefined();

  const replacementCallout = findPanelCard(
    screen.getByText("Replacing your CV changes the one you'll use for new jobs."),
  );

  expect(replacementCallout).not.toBeNull();
  expect(replacementCallout?.className).toContain('w-full');
  expect(replacementCallout?.className).not.toContain('max-w-4xl');
});

test('routes dropped files through the add-a-cv dropzone callback', () => {
  const onFileDrop = vi.fn();

  render(
    <OriginalCvScreen
      activeOriginalCv={null}
      isImportingOriginalCv={false}
      onFileDrop={onFileDrop}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  fireEvent.drop(screen.getByText('Drop a PDF or DOCX here or choose a file'), {
    dataTransfer: {
      files: [
        new File(['resume'], 'ada-lovelace.pdf', {
          type: 'application/pdf',
        }),
      ],
    },
  });

  expect(onFileDrop).toHaveBeenCalledTimes(1);
});

test('renders the Your CV metadata fallback card at full content width', () => {
  render(
    <OriginalCvScreen
      activeOriginalCv={createOriginalCvDetailFixture().originalCv}
      activeOriginalCvDetail={null}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={null}
    />,
  );

  const metadataCard = findPanelCard(screen.getByText('Original filename'));

  expect(metadataCard).not.toBeNull();
  expect(metadataCard?.className).toContain('w-full');
  expect(metadataCard?.className).not.toContain('max-w-3xl');
});

test('renders a shared page-top runtime alert on the Your CV screen', () => {
  render(
    <OriginalCvScreen
      activeOriginalCv={createOriginalCvDetailFixture().originalCv}
      activeOriginalCvDetail={createOriginalCvDetailFixture()}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={createRuntimeAlert({
        owner: {
          scope: 'original_cv',
          view: 'detail',
        },
        priority: 300,
        source: 'original_cv_detail',
        title: 'Preview unavailable.',
        variant: 'error',
      })}
    />,
  );

  expect(screen.getByRole('alert')).toBeDefined();
  expect(screen.getAllByText('Preview unavailable.')).toHaveLength(1);
});

test('renders the Add a CV alert below the page title and intro copy', () => {
  const { container } = render(
    <OriginalCvScreen
      activeOriginalCv={null}
      isImportingOriginalCv={false}
      onFileDrop={vi.fn()}
      onFileSelection={vi.fn()}
      onImportOriginalCv={vi.fn()}
      onSelectOriginalCv={vi.fn()}
      originalCvFile={null}
      runtimeAlert={createRuntimeAlert({
        owner: {
          scope: 'original_cv',
          view: 'empty',
        },
        priority: 300,
        source: 'original_cv_import',
        title: 'Choose a PDF or DOCX file.',
        variant: 'error',
      })}
    />,
  );

  const contentPane = container.querySelector('aside + div');
  expect(contentPane).not.toBeNull();

  const contentText = contentPane?.textContent ?? '';

  expect(contentText.indexOf('Add a CV')).toBeLessThan(
    contentText.indexOf('Choose the PDF or DOCX copy'),
  );
  expect(contentText.indexOf('Choose the PDF or DOCX copy')).toBeLessThan(
    contentText.indexOf('Choose a PDF or DOCX file.'),
  );
});
