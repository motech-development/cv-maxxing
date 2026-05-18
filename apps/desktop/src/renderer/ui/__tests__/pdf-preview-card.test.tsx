// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { TailoredApplicationPdfPreview } from '../../../shared/tailored-application.js';

const detachedBufferErrorMessage =
  "Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is already detached.";

const { getDocumentMock } = vi.hoisted(() => {
  return {
    getDocumentMock: vi.fn(),
  };
});

let activeGetViewportMock = vi.fn();

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  return {
    getDocument: getDocumentMock,
    GlobalWorkerOptions: {
      workerSrc: '',
    },
  };
});

import { PdfPreviewCard } from '../pdf-preview-card.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();

  activeGetViewportMock = vi.fn(({ scale }: { scale: number }) => {
    return {
      height: 1600 * scale,
      width: 1200 * scale,
    };
  });

  class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback;
    public readonly disconnect = vi.fn();
    public readonly unobserve = vi.fn();

    public constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    public observe(target: Element) {
      this.callback(
        [
          {
            borderBoxSize: [],
            contentBoxSize: [],
            contentRect: {
              bottom: 640,
              height: 640,
              left: 0,
              right: 300,
              toJSON: () => {
                return {};
              },
              top: 0,
              width: 300,
              x: 0,
              y: 0,
            },
            devicePixelContentBoxSize: [],
            target,
          } satisfies ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverMock,
  });

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => {
      return {} as CanvasRenderingContext2D;
    }),
  });

  getDocumentMock.mockImplementation(({ data }: { data: Uint8Array }) => {
    if (data.byteLength === 0) {
      return {
        destroy: vi.fn().mockImplementation(() => Promise.resolve()),
        promise: Promise.resolve().then(() => {
          throw new Error(detachedBufferErrorMessage);
        }),
      };
    }

    structuredClone(data.buffer, {
      transfer: [data.buffer],
    });

    return {
      destroy: vi.fn().mockImplementation(() => Promise.resolve()),
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: activeGetViewportMock,
          render: vi.fn().mockReturnValue({
            cancel: vi.fn(),
            promise: Promise.resolve(),
          }),
        }),
      }),
    };
  });
});

test('navigates between PDF pages without surfacing a detached worker buffer error', async () => {
  const preview: TailoredApplicationPdfPreview = {
    pageCount: 2,
    pageWarning: 'This PDF runs long but should not show a warning banner.',
    pdfBytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
  };

  render(
    <PdfPreviewCard
      emptyStateCopy="No PDF preview"
      preview={preview}
      previewKey="adapted-cv-preview"
      title="Adapted CV"
    />,
  );

  await waitFor(() => {
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
  });

  expect(screen.queryByText('This PDF runs long but should not show a warning banner.')).toBeNull();

  const previewCanvas = screen.getByLabelText('Adapted CV PDF preview');
  const previewScrollport = previewCanvas.parentElement;
  const previewFrame = previewScrollport?.parentElement;
  const previewCard = previewFrame?.parentElement;

  expect(previewCanvas.className).toContain('block');
  expect(previewCanvas.className).toContain('mx-auto');
  expect(previewScrollport?.className).toContain('h-full');
  expect(previewScrollport?.className).toContain('w-full');
  expect(previewScrollport?.className).toContain('overflow-auto');
  expect(previewFrame?.className).toContain('min-w-0');
  expect(previewFrame?.className).toContain('max-w-full');
  expect(previewFrame?.className).toContain('overflow-hidden');
  expect(previewFrame?.className).toContain('p-4');
  expect(previewCard?.className).toContain('min-w-0');
  expect(previewCard?.className).toContain('max-w-full');
  expect(previewCanvas).toHaveProperty('width', 300);
  expect(previewCanvas).toHaveProperty('height', 400);
  expect(activeGetViewportMock).toHaveBeenNthCalledWith(1, {
    scale: 1,
  });
  expect(activeGetViewportMock).toHaveBeenNthCalledWith(2, {
    scale: 0.25,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

  await waitFor(() => {
    expect(previewCanvas).toHaveProperty('width', 360);
  });

  expect(previewCanvas).toHaveProperty('height', 480);
  expect(activeGetViewportMock).toHaveBeenNthCalledWith(4, {
    scale: 0.3,
  });

  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

  await waitFor(() => {
    expect(screen.getByText('Page 2 of 2')).toBeDefined();
    expect(getDocumentMock).toHaveBeenCalledTimes(3);
  });

  expect(screen.queryByText(detachedBufferErrorMessage)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));

  await waitFor(() => {
    expect(screen.getByText('Page 1 of 2')).toBeDefined();
    expect(getDocumentMock).toHaveBeenCalledTimes(4);
  });

  expect(screen.queryByText(detachedBufferErrorMessage)).toBeNull();
});

test('reports PDF preview failures upward without rendering an inline runtime message', async () => {
  const onPreviewErrorChange = vi.fn();

  getDocumentMock.mockImplementationOnce(() => {
    return {
      destroy: vi.fn().mockImplementation(() => Promise.resolve()),
      promise: Promise.resolve().then(() => {
        throw new Error('PDF preview failed.');
      }),
    };
  });

  render(
    <PdfPreviewCard
      emptyStateCopy="No PDF preview"
      onPreviewErrorChange={onPreviewErrorChange}
      preview={{
        pageCount: 1,
        pdfBytes: new Uint8Array([37, 80, 68, 70]),
      }}
      previewKey="adapted-cv-preview"
      title="Adapted CV"
    />,
  );

  await waitFor(() => {
    expect(onPreviewErrorChange).toHaveBeenLastCalledWith('PDF preview failed.');
  });

  expect(screen.queryByText('PDF preview failed.')).toBeNull();
  expect(screen.getByLabelText('Adapted CV PDF preview').parentElement?.className).toContain(
    'hidden',
  );
});
