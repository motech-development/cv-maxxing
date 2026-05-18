import type { ReactNode } from 'react';

import type { TailoredApplicationPreview } from '../../shared/tailored-application.js';
import { Button } from '../ui/button.js';
import { PanelCard } from '../ui/panel-card.js';
import { PdfPreviewCard } from '../ui/pdf-preview-card.js';

type PreviewDocumentKind = 'adapted_cv' | 'cover_letter';

interface WorkspaceApplicationViewProperties {
  applicationTitle: string | null;
  isCopyingCoverLetterText: boolean;
  isExportingPdf: boolean;
  onCopyCoverLetterText: () => void;
  onDeleteTailoredApplication: () => void;
  onPreviewErrorChange?: (message: string | null) => void;
  onSelectPreviewDocument: (kind: PreviewDocumentKind) => void;
  preview: TailoredApplicationPreview | null;
  previewDocumentKind: PreviewDocumentKind;
}

export function WorkspaceApplicationView({
  applicationTitle,
  isCopyingCoverLetterText,
  isExportingPdf,
  onCopyCoverLetterText,
  onDeleteTailoredApplication,
  onPreviewErrorChange,
  onSelectPreviewDocument,
  preview,
  previewDocumentKind,
}: WorkspaceApplicationViewProperties) {
  const resolvedVacancySubtitle = preview?.employer ?? preview?.vacancyTitle ?? applicationTitle;
  let activeDocumentPreview = null;

  if (preview !== null) {
    activeDocumentPreview =
      previewDocumentKind === 'adapted_cv' ? preview.adaptedCv : preview.coverLetter;
  }

  const documentTitle = previewDocumentKind === 'adapted_cv' ? 'CV' : 'Cover letter';
  const documentEmptyStateCopy =
    previewDocumentKind === 'adapted_cv'
      ? 'Your CV will appear here.'
      : 'Your cover letter will appear here.';
  const previewStatusTags =
    preview === null
      ? []
      : [
          `CV · ${String(preview.adaptedCv.pageCount)} page${preview.adaptedCv.pageCount === 1 ? '' : 's'}`,
          `Cover letter · ${String(preview.coverLetter.pageCount)} page${preview.coverLetter.pageCount === 1 ? '' : 's'}`,
        ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 gap-4">
        <PanelCard className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-[18px]">
          <div className="flex gap-2">
            <button
              className={`rounded-[8px] px-3 py-2 text-[12px] font-extrabold ${
                previewDocumentKind === 'adapted_cv'
                  ? 'bg-[var(--color-ink-900)] text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-copy-strong)]'
              }`}
              onClick={() => {
                onSelectPreviewDocument('adapted_cv');
              }}
              type="button"
            >
              CV
            </button>
            <button
              className={`rounded-[8px] px-3 py-2 text-[12px] font-extrabold ${
                previewDocumentKind === 'cover_letter'
                  ? 'bg-[var(--color-ink-900)] text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-copy-strong)]'
              }`}
              onClick={() => {
                onSelectPreviewDocument('cover_letter');
              }}
              type="button"
            >
              Cover letter
            </button>
          </div>
          <PdfPreviewCard
            emptyStateCopy={documentEmptyStateCopy}
            onPreviewErrorChange={onPreviewErrorChange}
            preview={activeDocumentPreview}
            previewKey={
              preview === null ? previewDocumentKind : `${preview.id}:${previewDocumentKind}`
            }
            title={documentTitle}
          />
        </PanelCard>

        <PanelCard className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto p-[18px]">
          <h2 className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">
            About this job
          </h2>
          <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
            {resolvedVacancySubtitle}
          </p>
          {preview?.vacancy.responsibilities[0] ? (
            <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
              {preview.vacancy.responsibilities[0]}
            </p>
          ) : null}
          <div className="h-px bg-[var(--color-border)]" />
          <div className="flex flex-col gap-2">
            {previewStatusTags.map((tag) => {
              return (
                <div
                  className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-extrabold text-[var(--color-copy-strong)]"
                  key={tag}
                >
                  {tag}
                </div>
              );
            })}
          </div>
          {preview ? (
            <>
              <DetailSection title="Your CV">
                <p className="m-0 text-xs font-extrabold text-[var(--color-copy-strong)]">
                  {preview.originalCv.originalFilename}
                </p>
                <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
                  {preview.originalCv.headline}
                </p>
                <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
                  Imported {formatTimestamp(preview.originalCv.importedAt)}
                </p>
              </DetailSection>
              <DetailSection title="Highlighted in your CV">
                <DetailList
                  emptyMessage="Nothing highlighted yet."
                  items={[
                    ...preview.adaptationSummary.emphasized.map((item) => {
                      return item.text;
                    }),
                    ...preview.adaptationSummary.omitted.map((item) => {
                      return item.text;
                    }),
                  ]}
                />
              </DetailSection>
              <DetailSection title="Worth checking">
                <DetailList
                  emptyMessage="Nothing to double-check right now."
                  items={[
                    ...preview.adaptationSummary.gaps,
                    ...preview.adaptationSummary.validationHints,
                  ]}
                />
              </DetailSection>
            </>
          ) : null}
          <Button
            disabled={preview === null || isCopyingCoverLetterText}
            onClick={onCopyCoverLetterText}
            tone="primary"
          >
            Copy cover letter text
          </Button>
          <Button
            className="border-[var(--color-border)] bg-[var(--color-surface-danger)] text-[var(--color-status-danger)] hover:bg-[#ffe5e5]"
            disabled={preview === null || isExportingPdf}
            onClick={onDeleteTailoredApplication}
            tone="secondary"
          >
            Delete this job
          </Button>
        </PanelCard>
      </div>
    </div>
  );
}

function DetailList({ emptyMessage, items }: { emptyMessage?: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <p className="m-0 text-xs leading-5 text-[var(--color-copy-muted)]">
        {emptyMessage ?? 'No items recorded.'}
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-disc flex-col gap-2 pl-4 text-xs leading-5 text-[var(--color-copy-muted)]">
      {items.map((item, index) => {
        return <li key={`${item}-${String(index)}`}>{item}</li>;
      })}
    </ul>
  );
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-copy-subtle)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
