import type { AdaptedCvExperienceEntry } from '../shared/tailored-application.js'

export interface AdaptedCvBrowserRenderPayload {
  contactLines: string[]
  continuableSections: AdaptedCvBrowserContinuableSection[]
  introLabel: string
  profileText: string
  rightSections: AdaptedCvBrowserSidebarSection[]
  roleLabel: string
  title: string
}

export type AdaptedCvBrowserContinuableSection =
  | {
      items: AdaptedCvExperienceEntry[]
      kind: 'experience'
      label: 'EXPERIENCE'
    }
  | {
      items: string[]
      kind: 'impact_highlights' | 'selected_work'
      label: 'IMPACT HIGHLIGHTS' | 'SELECTED WORK'
    }

export type AdaptedCvBrowserSidebarSection =
  | {
      items: string[]
      kind: 'list'
      label: string
    }
  | {
      entry: {
        meta: string
        title: string
      }
      kind: 'education'
      label: 'EDUCATION'
    }
  | {
      kind: 'references'
      label: 'REFERENCES'
      text: 'Available on request'
    }

interface RenderAdaptedCvPagesInBrowserOptions {
  document?: Document
  isPageOverflowing?: (pageElement: HTMLElement, appendedElement: HTMLElement) => boolean
  rootElementId?: string
}

const PAGE_BOTTOM_CLEARANCE_PX = 24

export function renderAdaptedCvPagesInBrowser(
  payload: AdaptedCvBrowserRenderPayload,
  options: RenderAdaptedCvPagesInBrowserOptions = {},
): number {
  const documentReference = options.document ?? globalThis.document
  const rootElementId = options.rootElementId ?? 'cv-document-root'
  const pageBottomClearance = 24
  const doesElementOverflowPage = (
    pageElement: HTMLElement,
    appendedElement: HTMLElement,
  ): boolean => {
    const pageRectangle = pageElement.getBoundingClientRect()
    const appendedRectangle = appendedElement.getBoundingClientRect()

    if (appendedRectangle.height === 0 && appendedRectangle.width === 0) {
      return false
    }

    const safeBottomBoundary = pageRectangle.bottom - pageBottomClearance

    return (
      appendedRectangle.bottom > safeBottomBoundary + 1 ||
      pageElement.scrollHeight - pageElement.clientHeight > 1
    )
  }
  const rootElement = documentReference.querySelector<HTMLElement>(`#${rootElementId}`)

  if (!(rootElement instanceof HTMLElement)) {
    throw new TypeError('Adapted CV root element was not found for browser pagination.')
  }

  const isPageOverflowing =
    options.isPageOverflowing ??
    ((pageElement: HTMLElement, appendedElement: HTMLElement) => {
      return doesElementOverflowPage(pageElement, appendedElement)
    })

  rootElement.replaceChildren()

  let pageNumber = 0

  const createSectionLabelElement = (label: string): HTMLHeadingElement => {
    const labelElement = documentReference.createElement('h2')
    labelElement.className = 'section-label'
    labelElement.textContent = label

    return labelElement
  }

  const createMainPage = (): {
    contentContainerElement: HTMLElement
    pageElement: HTMLElement
    sidebarElement: HTMLElement
  } => {
    pageNumber += 1

    const pageElement = documentReference.createElement('section')
    pageElement.className = `cv-page page-${String(pageNumber)}`
    pageElement.dataset.pageNumber = String(pageNumber)

    const headerElement = documentReference.createElement('header')
    headerElement.className = 'header-main'

    const identityElement = documentReference.createElement('section')
    identityElement.className = 'identity-main'

    const nameElement = documentReference.createElement('h1')
    nameElement.className = 'name-main'
    nameElement.textContent = payload.title

    const roleElement = documentReference.createElement('p')
    roleElement.className = 'role-main'
    roleElement.textContent = payload.roleLabel

    const introElement = documentReference.createElement('p')
    introElement.className = 'intro-main'
    introElement.textContent = payload.introLabel

    identityElement.append(nameElement, roleElement, introElement)

    const contactListElement = documentReference.createElement('section')
    contactListElement.className = 'contact-list'

    for (const line of payload.contactLines) {
      const lineElement = documentReference.createElement('p')
      lineElement.textContent = line
      contactListElement.append(lineElement)
    }

    headerElement.append(identityElement, contactListElement)

    const dividerElement = documentReference.createElement('div')
    dividerElement.className = 'divider'

    const bodyElement = documentReference.createElement('section')
    bodyElement.className = 'body-main'

    const leftColumnElement = documentReference.createElement('section')
    leftColumnElement.className = 'left-col'

    const rightColumnElement = documentReference.createElement('aside')
    rightColumnElement.className = 'right-col'

    bodyElement.append(leftColumnElement, rightColumnElement)
    pageElement.append(headerElement, dividerElement, bodyElement)
    rootElement.append(pageElement)

    return {
      contentContainerElement: leftColumnElement,
      pageElement,
      sidebarElement: rightColumnElement,
    }
  }

  const createContinuedPage = (): {
    contentContainerElement: HTMLElement
    pageElement: HTMLElement
  } => {
    pageNumber += 1

    const pageElement = documentReference.createElement('section')
    pageElement.className = `cv-page page-${String(pageNumber)}`
    pageElement.dataset.pageNumber = String(pageNumber)

    const headerElement = documentReference.createElement('header')
    headerElement.className = 'header-continued'

    const nameElement = documentReference.createElement('p')
    nameElement.className = 'name-continued'
    nameElement.textContent = payload.title

    const roleElement = documentReference.createElement('p')
    roleElement.className = 'role-continued'
    roleElement.textContent = payload.roleLabel

    const introElement = documentReference.createElement('p')
    introElement.className = 'intro-continued'
    introElement.textContent = 'Curriculum Vitae - Continued'

    headerElement.append(nameElement, roleElement, introElement)

    const dividerElement = documentReference.createElement('div')
    dividerElement.className = 'divider'

    const bodyElement = documentReference.createElement('section')
    bodyElement.className = 'body-continued'

    pageElement.append(headerElement, dividerElement, bodyElement)
    rootElement.append(pageElement)

    return {
      contentContainerElement: bodyElement,
      pageElement,
    }
  }

  const createProfileSection = (profileText: string): HTMLElement => {
    const sectionElement = documentReference.createElement('section')
    sectionElement.className = 'section-profile'

    const labelElement = createSectionLabelElement('PROFILE')

    const textElement = documentReference.createElement('p')
    textElement.className = 'profile-text'
    textElement.textContent = profileText

    sectionElement.append(labelElement, textElement)

    return sectionElement
  }

  const createSidebarSection = (section: AdaptedCvBrowserSidebarSection): HTMLElement => {
    if (section.kind === 'list') {
      const sectionElement = documentReference.createElement('section')
      sectionElement.className = 'sidebar-section-gap-8'
      sectionElement.append(createSectionLabelElement(section.label))

      for (const item of section.items) {
        const itemElement = documentReference.createElement('p')
        itemElement.className = 'sidebar-line'
        itemElement.textContent = item
        sectionElement.append(itemElement)
      }

      return sectionElement
    }

    if (section.kind === 'education') {
      const sectionElement = documentReference.createElement('section')
      sectionElement.className = 'sidebar-section-gap-8'

      const titleElement = documentReference.createElement('p')
      titleElement.className = 'edu-title'
      titleElement.textContent = section.entry.title

      const metaElement = documentReference.createElement('p')
      metaElement.className = 'edu-meta'
      metaElement.textContent = section.entry.meta

      sectionElement.append(createSectionLabelElement(section.label), titleElement, metaElement)

      return sectionElement
    }

    const sectionElement = documentReference.createElement('section')
    sectionElement.className = 'sidebar-section-gap-8'

    const textElement = documentReference.createElement('p')
    textElement.className = 'sidebar-line'
    textElement.textContent = section.text

    sectionElement.append(createSectionLabelElement(section.label), textElement)

    return sectionElement
  }

  const createExperienceSection = (
    label: string,
    isContinued: boolean,
  ): {
    itemsContainerElement: HTMLElement
    sectionElement: HTMLElement
  } => {
    const sectionElement = documentReference.createElement('section')
    sectionElement.className = isContinued ? 'section-experience-continued' : 'section-experience'

    const itemsContainerElement = documentReference.createElement('div')
    itemsContainerElement.className = 'experience-list'

    sectionElement.append(
      createSectionLabelElement(isContinued ? `${label} (CONTINUED)` : label),
      itemsContainerElement,
    )

    return {
      itemsContainerElement,
      sectionElement,
    }
  }

  const createExperienceItem = (item: AdaptedCvExperienceEntry): HTMLElement => {
    const itemElement = documentReference.createElement('article')
    itemElement.className = 'experience-item'

    const titleElement = documentReference.createElement('p')
    titleElement.className = 'exp-title'
    titleElement.textContent = [item.roleTitle, item.employer]
      .filter((value) => {
        return value.trim() !== ''
      })
      .join(' · ')

    const metaElement = documentReference.createElement('p')
    metaElement.className = 'exp-meta'
    metaElement.textContent = [item.location, item.dateRange]
      .filter((value): value is string => {
        return value !== null && value.trim() !== ''
      })
      .join(' · ')

    itemElement.append(titleElement, metaElement)

    for (const bullet of item.bullets) {
      const bulletRowElement = documentReference.createElement('div')
      bulletRowElement.className = 'bullet-row'

      const bulletMarkElement = documentReference.createElement('span')
      bulletMarkElement.className = 'bullet-mark'
      bulletMarkElement.textContent = '•'

      const bulletTextElement = documentReference.createElement('span')
      bulletTextElement.className = 'bullet-text'
      bulletTextElement.textContent = bullet.text

      bulletRowElement.append(bulletMarkElement, bulletTextElement)
      itemElement.append(bulletRowElement)
    }

    return itemElement
  }

  const createTextBlockSection = (
    label: string,
    isContinued: boolean,
  ): {
    itemsContainerElement: HTMLElement
    sectionElement: HTMLElement
  } => {
    const sectionElement = documentReference.createElement('section')
    sectionElement.className = 'section-text-block'

    const itemsContainerElement = documentReference.createElement('div')
    itemsContainerElement.className = 'text-block-list'

    sectionElement.append(
      createSectionLabelElement(isContinued ? `${label} (CONTINUED)` : label),
      itemsContainerElement,
    )

    return {
      itemsContainerElement,
      sectionElement,
    }
  }

  const createTextBlockItem = (text: string): HTMLElement => {
    const itemElement = documentReference.createElement('p')
    itemElement.className = 'section-line'
    itemElement.textContent = text

    return itemElement
  }

  const firstPage = createMainPage()
  firstPage.contentContainerElement.append(createProfileSection(payload.profileText))

  for (const section of payload.rightSections) {
    firstPage.sidebarElement.append(createSidebarSection(section))
  }

  let currentPage:
    | {
        contentContainerElement: HTMLElement
        pageElement: HTMLElement
      }
    | {
        contentContainerElement: HTMLElement
        pageElement: HTMLElement
        sidebarElement: HTMLElement
      } = firstPage

  for (const section of payload.continuableSections) {
    if (section.kind === 'experience') {
      let hasStarted = false
      let currentSection = createExperienceSection(section.label, hasStarted)
      currentPage.contentContainerElement.append(currentSection.sectionElement)

      for (const item of section.items) {
        const itemElement = createExperienceItem(item)
        currentSection.itemsContainerElement.append(itemElement)

        if (isPageOverflowing(currentPage.pageElement, itemElement)) {
          itemElement.remove()

          if (currentSection.itemsContainerElement.childElementCount === 0) {
            currentSection.sectionElement.remove()
          }

          currentPage = createContinuedPage()
          currentSection = createExperienceSection(section.label, hasStarted)
          currentPage.contentContainerElement.append(currentSection.sectionElement)
          currentSection.itemsContainerElement.append(itemElement)
        }

        hasStarted = true
      }

      continue
    }

    let hasStarted = false
    let currentSection = createTextBlockSection(section.label, hasStarted)
    currentPage.contentContainerElement.append(currentSection.sectionElement)

    for (const item of section.items) {
      const itemElement = createTextBlockItem(item)
      currentSection.itemsContainerElement.append(itemElement)

      if (isPageOverflowing(currentPage.pageElement, itemElement)) {
        itemElement.remove()

        if (currentSection.itemsContainerElement.childElementCount === 0) {
          currentSection.sectionElement.remove()
        }

        currentPage = createContinuedPage()
        currentSection = createTextBlockSection(section.label, hasStarted)
        currentPage.contentContainerElement.append(currentSection.sectionElement)
        currentSection.itemsContainerElement.append(itemElement)
      }

      hasStarted = true
    }
  }

  return rootElement.querySelectorAll('.cv-page').length
}

export function doesPageOverflowWithBottomClearance(pageElement: HTMLElement): boolean {
  const descendantElements = [...pageElement.querySelectorAll<HTMLElement>('*')]

  return (
    descendantElements.some((descendantElement) => {
      return doesElementOverflowPageWithBottomClearance(
        pageElement,
        descendantElement,
        PAGE_BOTTOM_CLEARANCE_PX,
      )
    }) || pageElement.scrollHeight - pageElement.clientHeight > 1
  )
}

export function doesElementOverflowPageWithBottomClearance(
  pageElement: HTMLElement,
  appendedElement: HTMLElement,
  bottomClearance: number = PAGE_BOTTOM_CLEARANCE_PX,
): boolean {
  const pageRectangle = pageElement.getBoundingClientRect()
  const appendedRectangle = appendedElement.getBoundingClientRect()

  if (appendedRectangle.height === 0 && appendedRectangle.width === 0) {
    return false
  }

  const safeBottomBoundary = pageRectangle.bottom - bottomClearance

  return (
    appendedRectangle.bottom > safeBottomBoundary + 1 ||
    pageElement.scrollHeight - pageElement.clientHeight > 1
  )
}
