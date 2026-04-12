// @vitest-environment jsdom

import { expect, test } from 'vitest'

import type { AdaptedCvExperienceEntry } from '../../shared/tailored-application.js'
import {
  doesElementOverflowPageWithBottomClearance,
  doesPageOverflowWithBottomClearance,
  renderAdaptedCvPagesInBrowser,
  type AdaptedCvBrowserRenderPayload,
} from '../adapted-cv-browser-pagination.js'

test('treats a page as full before the last printable pixels to preserve bottom clearance', () => {
  const pageElement = document.createElement('section')

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1125,
    },
  })

  expect(doesPageOverflowWithBottomClearance(pageElement)).toBe(true)
})

test('treats descendant geometry crossing the safe bottom boundary as overflow', () => {
  const pageElement = document.createElement('section')
  const childElement = document.createElement('p')

  pageElement.append(childElement)

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1123,
    },
  })

  pageElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 1123,
      width: 794,
      x: 0,
      y: 0,
    })
  }

  childElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 1088,
    })
  }

  expect(doesPageOverflowWithBottomClearance(pageElement)).toBe(true)
})

test('checks overflow against the appended item instead of unrelated page descendants', () => {
  const pageElement = document.createElement('section')
  const priorDescendantElement = document.createElement('p')
  const appendedElement = document.createElement('p')

  pageElement.append(priorDescendantElement, appendedElement)

  Object.defineProperties(pageElement, {
    clientHeight: {
      configurable: true,
      value: 1123,
    },
    scrollHeight: {
      configurable: true,
      value: 1123,
    },
  })

  pageElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 1123,
      width: 794,
      x: 0,
      y: 0,
    })
  }

  priorDescendantElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 1088,
    })
  }

  appendedElement.getBoundingClientRect = () => {
    return DOMRect.fromRect({
      height: 24,
      width: 400,
      x: 0,
      y: 900,
    })
  }

  expect(doesElementOverflowPageWithBottomClearance(pageElement, appendedElement)).toBe(false)
})

test('fills the first and continued pages until the measured overflow boundary is reached', () => {
  document.body.innerHTML = '<main class="cv-document" id="cv-document-root"></main>'

  const pageCount = renderAdaptedCvPagesInBrowser(createPayloadWithExperienceCount(8), {
    isPageOverflowing: (pageElement) => {
      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber ?? '1', 10)
      const experienceItems = pageElement.querySelectorAll('.experience-item').length
      const maximumItems = pageNumber === 1 ? 3 : 5

      return experienceItems > maximumItems
    },
  })

  const pages = [...document.querySelectorAll<HTMLElement>('.cv-page')]
  const firstPageExperienceItems = pages[0]?.querySelectorAll('.experience-item').length
  const secondPageExperienceItems = pages[1]?.querySelectorAll('.experience-item').length

  expect(pageCount).toBe(2)
  expect(pages).toHaveLength(2)
  expect(firstPageExperienceItems).toBe(3)
  expect(secondPageExperienceItems).toBe(5)
  expect(pages[1]?.textContent).toContain('EXPERIENCE (CONTINUED)')
})

test('starts the section on the next page without a continued label when nothing fit on page one', () => {
  document.body.innerHTML = '<main class="cv-document" id="cv-document-root"></main>'

  const pageCount = renderAdaptedCvPagesInBrowser(createPayloadWithExperienceCount(3), {
    isPageOverflowing: (pageElement) => {
      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber ?? '1', 10)
      const experienceItems = pageElement.querySelectorAll('.experience-item').length

      return pageNumber === 1 ? experienceItems > 0 : false
    },
  })

  const pages = [...document.querySelectorAll<HTMLElement>('.cv-page')]

  expect(pageCount).toBe(2)
  expect(pages[0]?.textContent).not.toContain('EXPERIENCE (CONTINUED)')
  expect(pages[1]?.textContent).toContain('EXPERIENCE')
  expect(pages[1]?.textContent).not.toContain('EXPERIENCE (CONTINUED)')
})

function createPayloadWithExperienceCount(experienceCount: number): AdaptedCvBrowserRenderPayload {
  return {
    contactLines: ['London, United Kingdom', '+44 7700 900123', 'ada@lovelace.dev'],
    continuableSections: [
      {
        items: Array.from({ length: experienceCount }, (_, index) => {
          return createExperienceEntry(index + 1)
        }),
        kind: 'experience',
        label: 'EXPERIENCE',
      },
    ],
    introLabel: 'Design leader shaping truthful desktop workflow products for technical users.',
    profileText: 'Design leader adapting complex desktop workflow products for technical users.',
    rightSections: [],
    roleLabel: 'Principal Product Designer',
    title: 'Ada Lovelace',
  }
}

function createExperienceEntry(index: number): AdaptedCvExperienceEntry {
  return {
    bullets: [
      {
        text: `Evidence-backed workflow accomplishment ${String(index)} for technical users.`,
      },
    ],
    dateRange: `20${String(index).padStart(2, '0')} — Present`,
    employer: `Employer ${String(index)}`,
    location: `Location ${String(index)}`,
    roleTitle: `Role ${String(index)}`,
  }
}
