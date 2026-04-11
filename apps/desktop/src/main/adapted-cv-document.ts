import type {
  AdaptedCvExperienceEntry,
  AdaptedCvModel,
  AdaptedCvSection,
} from '../shared/tailored-application.js'

const PAGE_WARNING_THRESHOLD = 3
const PAGE_ONE_CAPACITY = 48
const CONTINUED_PAGE_CAPACITY = 40
const SAFE_FILENAME_CHARACTER = /[^a-z0-9]+/giu

interface AdaptedCvDocumentInput {
  adaptedCv: AdaptedCvModel
  employer: string | null
  vacancyTitle: string | null
}

interface AdaptedCvPage {
  kind: 'continued' | 'main'
  leftSections: AdaptedCvPageSection[]
  rightSections: AdaptedCvPageSection[]
}

type ContinuableSectionState =
  | {
      hasStarted: boolean
      kind: 'experience'
      remainingItems: AdaptedCvExperienceEntry[]
    }
  | {
      hasStarted: boolean
      kind: 'impact_highlights' | 'selected_work'
      remainingItems: string[]
    }

type AdaptedCvPageSection =
  | {
      kind: 'experience'
      isContinued: boolean
      items: AdaptedCvExperienceEntry[]
    }
  | {
      kind: 'profile'
      text: string
    }
  | {
      isContinued: boolean
      items: string[]
      kind: 'impact_highlights' | 'selected_work'
    }
  | {
      entry: {
        meta: string
        title: string
      }
      kind: 'education'
    }
  | {
      kind: 'core_skills' | 'certifications' | 'focus' | 'languages' | 'tools'
      items: string[]
    }
  | {
      kind: 'references'
    }

export interface AdaptedCvDocument {
  html: string
  pageCount: number
  pageWarning: string | null
}

export function createAdaptedCvDocument(input: AdaptedCvDocumentInput): AdaptedCvDocument {
  const pages = paginateAdaptedCv(input)
  const html = buildDocumentHtml({
    contactLines: buildHeaderContactLines(input.adaptedCv.header.contact),
    introLabel: input.adaptedCv.header.intro.text,
    pages,
    roleLabel: input.adaptedCv.headline.text,
    title: input.adaptedCv.candidateName,
  })

  return {
    html,
    pageCount: pages.length,
    pageWarning: pages.length > PAGE_WARNING_THRESHOLD ? buildPageWarning(pages.length) : null,
  }
}

export function buildAdaptedCvExportFilename({
  candidateName,
  vacancyTitle,
}: {
  candidateName: string
  vacancyTitle: string | null
}): string {
  const safeCandidateName = sanitizeFilenamePart(candidateName)
  const safeVacancyTitle = sanitizeFilenamePart(vacancyTitle ?? 'adapted cv')

  return `${safeCandidateName} - ${safeVacancyTitle} - adapted-cv.pdf`
}

export async function resolveUniqueExportFilePath(
  desiredFilePath: string,
  fileExists: (candidatePath: string) => Promise<boolean>,
): Promise<string> {
  const splitIndex = desiredFilePath.lastIndexOf('.')
  const basePath = splitIndex === -1 ? desiredFilePath : desiredFilePath.slice(0, splitIndex)
  const extension = splitIndex === -1 ? '' : desiredFilePath.slice(splitIndex)

  if (await fileExists(desiredFilePath)) {
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidatePath = `${basePath} (${String(suffix)})${extension}`

      if (!(await fileExists(candidatePath))) {
        return candidatePath
      }
    }

    return `${basePath} (${String(Date.now())})${extension}`
  }

  return desiredFilePath
}

function paginateAdaptedCv(input: AdaptedCvDocumentInput): AdaptedCvPage[] {
  const profileSection = getRequiredSection(input.adaptedCv.sections, 'profile')
  const continuableSections = buildContinuableSectionStates(input.adaptedCv.sections)
  const pages: AdaptedCvPage[] = []
  const firstPageLeftSections: AdaptedCvPageSection[] = [
    {
      kind: 'profile',
      text: profileSection.summary.text,
    },
  ]
  const firstPageRightSections: AdaptedCvPageSection[] = []

  const firstPageCapacity = PAGE_ONE_CAPACITY - estimateProfileHeight(profileSection.summary.text)

  fillContinuableSections(continuableSections, firstPageCapacity, firstPageLeftSections)
  firstPageRightSections.push(...buildRightSections(input.adaptedCv.sections))

  pages.push({
    kind: 'main',
    leftSections: firstPageLeftSections,
    rightSections: firstPageRightSections,
  })

  while (continuableSections.length > 0) {
    const continuedPageSections: AdaptedCvPageSection[] = []
    fillContinuableSections(continuableSections, CONTINUED_PAGE_CAPACITY, continuedPageSections)

    pages.push({
      kind: 'continued',
      leftSections: continuedPageSections,
      rightSections: [],
    })
  }

  return pages
}

function buildContinuableSectionStates(sections: AdaptedCvSection[]): ContinuableSectionState[] {
  const experienceSection = getRequiredSection(sections, 'experience')
  const selectedWorkSection = getOptionalSection(sections, 'selected_work')
  const impactHighlightsSection = getOptionalSection(sections, 'impact_highlights')

  return [
    {
      hasStarted: false,
      kind: 'experience',
      remainingItems: [...experienceSection.items],
    },
    ...(selectedWorkSection === null || selectedWorkSection.items.length === 0
      ? []
      : [
          {
            hasStarted: false,
            kind: 'selected_work' as const,
            remainingItems: selectedWorkSection.items.map((item) => {
              return item.text
            }),
          },
        ]),
    ...(impactHighlightsSection === null || impactHighlightsSection.items.length === 0
      ? []
      : [
          {
            hasStarted: false,
            kind: 'impact_highlights' as const,
            remainingItems: impactHighlightsSection.items.map((item) => {
              return item.text
            }),
          },
        ]),
  ]
}

function buildRightSections(sections: AdaptedCvSection[]): AdaptedCvPageSection[] {
  const coreSkillsSection = getRequiredSection(sections, 'core_skills')
  const toolsSection = getOptionalSection(sections, 'tools')
  const educationSection = getOptionalSection(sections, 'education')
  const certificationsSection = getOptionalSection(sections, 'certifications')
  const languagesSection = getOptionalSection(sections, 'languages')
  const focusSection = getOptionalSection(sections, 'focus')

  return [
    {
      items: coreSkillsSection.items.map((item) => {
        return item.text
      }),
      kind: 'core_skills',
    },
    ...createSidebarListSection(toolsSection, 'tools'),
    ...(educationSection?.entry === null || educationSection === null
      ? []
      : [
          {
            entry: educationSection.entry,
            kind: 'education' as const,
          },
        ]),
    ...createSidebarListSection(certificationsSection, 'certifications'),
    ...createSidebarListSection(languagesSection, 'languages'),
    ...createSidebarListSection(focusSection, 'focus'),
    {
      kind: 'references',
    },
  ]
}

function getRequiredSection<K extends AdaptedCvSection['kind']>(
  sections: AdaptedCvSection[],
  kind: K,
): Extract<AdaptedCvSection, { kind: K }> {
  const matchingSection = sections.find((section) => {
    return section.kind === kind
  })

  if (matchingSection === undefined) {
    throw new Error(`Adapted CV is missing the required ${kind} section.`)
  }

  return matchingSection as Extract<AdaptedCvSection, { kind: K }>
}

function getOptionalSection<K extends AdaptedCvSection['kind']>(
  sections: AdaptedCvSection[],
  kind: K,
): Extract<AdaptedCvSection, { kind: K }> | null {
  const matchingSection = sections.find((section) => {
    return section.kind === kind
  })

  return matchingSection === undefined
    ? null
    : (matchingSection as Extract<AdaptedCvSection, { kind: K }>)
}

function estimateProfileHeight(summaryText: string): number {
  return 5 + Math.ceil(summaryText.length / 150)
}

function estimateExperienceSectionHeight(
  items: AdaptedCvExperienceEntry[],
  isContinued: boolean,
): number {
  const headingHeight = isContinued ? 3 : 4
  const itemsHeight = items.reduce((totalHeight, item) => {
    const headingHeight = 3
    const metaHeight = 2 + (item.location === null ? 0 : 1)
    const bulletsHeight = item.bullets.reduce((totalBulletHeight, bullet) => {
      return totalBulletHeight + 2 + Math.ceil(bullet.text.length / 110)
    }, 0)

    return totalHeight + headingHeight + metaHeight + bulletsHeight
  }, 0)

  return headingHeight + itemsHeight
}

function estimateTextBlockSectionHeight(items: string[], isContinued: boolean): number {
  const headingHeight = isContinued ? 3 : 4

  return (
    headingHeight +
    items.reduce((totalHeight, item) => {
      return totalHeight + 2 + Math.ceil(item.length / 95)
    }, 0)
  )
}

function fillContinuableSections(
  continuableSections: ContinuableSectionState[],
  availableHeight: number,
  pageSections: AdaptedCvPageSection[],
): number {
  let remainingHeight = availableHeight

  while (continuableSections.length > 0) {
    const currentSection = continuableSections[0]

    if (currentSection === undefined) {
      break
    }

    if (currentSection.kind === 'experience') {
      const items = takeExperienceItems(currentSection.remainingItems, remainingHeight)

      if (items.length === 0) {
        break
      }

      pageSections.push({
        items,
        isContinued: currentSection.hasStarted,
        kind: 'experience',
      })
      remainingHeight -= estimateExperienceSectionHeight(items, currentSection.hasStarted)

      if (currentSection.remainingItems.length === 0) {
        continuableSections.shift()

        continue
      }

      currentSection.hasStarted = true

      break
    }

    const items = takeTextBlockItems(
      currentSection.remainingItems,
      remainingHeight,
      currentSection.hasStarted,
    )

    if (items.length === 0) {
      break
    }

    pageSections.push({
      isContinued: currentSection.hasStarted,
      items,
      kind: currentSection.kind,
    })
    remainingHeight -= estimateTextBlockSectionHeight(items, currentSection.hasStarted)

    if (currentSection.remainingItems.length === 0) {
      continuableSections.shift()

      continue
    }

    currentSection.hasStarted = true

    break
  }

  return remainingHeight
}

function takeExperienceItems(
  remainingExperience: AdaptedCvExperienceEntry[],
  availableHeight: number,
): AdaptedCvExperienceEntry[] {
  const selectedItems: AdaptedCvExperienceEntry[] = []
  let consumedHeight = 0

  while (remainingExperience.length > 0) {
    const nextItem = remainingExperience[0]

    if (nextItem === undefined) {
      break
    }

    const nextItemHeight = estimateExperienceSectionHeight([nextItem], selectedItems.length > 0)

    if (selectedItems.length > 0 && consumedHeight + nextItemHeight > availableHeight) {
      break
    }

    selectedItems.push(nextItem)
    consumedHeight += nextItemHeight
    remainingExperience.shift()

    if (consumedHeight >= availableHeight) {
      break
    }
  }

  if (selectedItems.length === 0 && remainingExperience.length > 0) {
    const forcedItem = remainingExperience.shift()

    if (forcedItem !== undefined) {
      selectedItems.push(forcedItem)
    }
  }

  return selectedItems
}

function takeTextBlockItems(
  remainingItems: string[],
  availableHeight: number,
  isContinued: boolean,
): string[] {
  const selectedItems: string[] = []
  let consumedHeight = 0

  while (remainingItems.length > 0) {
    const nextItem = remainingItems[0]

    if (nextItem === undefined) {
      break
    }

    const nextItemHeight = estimateTextBlockSectionHeight(
      [nextItem],
      isContinued || selectedItems.length > 0,
    )

    if (selectedItems.length > 0 && consumedHeight + nextItemHeight > availableHeight) {
      break
    }

    selectedItems.push(nextItem)
    consumedHeight += nextItemHeight
    remainingItems.shift()

    if (consumedHeight >= availableHeight) {
      break
    }
  }

  if (selectedItems.length === 0 && remainingItems.length > 0) {
    const forcedItem = remainingItems.shift()

    if (forcedItem !== undefined) {
      selectedItems.push(forcedItem)
    }
  }

  return selectedItems
}

function buildDocumentHtml({
  contactLines,
  introLabel,
  pages,
  roleLabel,
  title,
}: {
  contactLines: string[]
  introLabel: string
  pages: AdaptedCvPage[]
  roleLabel: string
  title: string
}): string {
  const pageMarkup = pages
    .map((page, pageIndex) => {
      return page.kind === 'main'
        ? buildMainPageMarkup({
            contactLines,
            introLabel,
            page,
            roleLabel,
            title,
          })
        : buildContinuedPageMarkup({
            page,
            pageNumber: pageIndex + 1,
            roleLabel,
            title,
          })
    })
    .join('')

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Adapted CV</title>',
    '<style>',
    buildDocumentStyles(),
    '</style>',
    '</head>',
    '<body>',
    '<main class="cv-document">',
    pageMarkup,
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}

function buildMainPageMarkup({
  contactLines,
  introLabel,
  page,
  roleLabel,
  title,
}: {
  contactLines: string[]
  introLabel: string
  page: AdaptedCvPage
  roleLabel: string
  title: string
}): string {
  const leftSectionsMarkup = page.leftSections
    .map((section) => {
      return buildSectionMarkup(section)
    })
    .join('')
  const rightSectionsMarkup = page.rightSections
    .map((section) => {
      return buildSectionMarkup(section)
    })
    .join('')
  const contactMarkup = contactLines
    .map((line) => {
      return `<p>${escapeHtml(line)}</p>`
    })
    .join('')

  return [
    '<section class="cv-page page-1">',
    '<header class="header-main">',
    '<section class="identity-main">',
    `<h1 class="name-main">${escapeHtml(title)}</h1>`,
    `<p class="role-main">${escapeHtml(roleLabel)}</p>`,
    `<p class="intro-main">${escapeHtml(introLabel)}</p>`,
    '</section>',
    '<section class="contact-list">',
    contactMarkup,
    '</section>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="body-main">',
    '<section class="left-col">',
    leftSectionsMarkup,
    '</section>',
    '<aside class="right-col">',
    rightSectionsMarkup,
    '</aside>',
    '</section>',
    '</section>',
  ].join('')
}

function buildContinuedPageMarkup({
  page,
  pageNumber,
  roleLabel,
  title,
}: {
  page: AdaptedCvPage
  pageNumber: number
  roleLabel: string
  title: string
}): string {
  const continuedSections = page.leftSections
    .map((section) => {
      return buildSectionMarkup(section)
    })
    .join('')

  return [
    `<section class="cv-page page-${String(pageNumber)}">`,
    '<header class="header-continued">',
    `<p class="name-continued">${escapeHtml(title)}</p>`,
    `<p class="role-continued">${escapeHtml(roleLabel)}</p>`,
    '<p class="intro-continued">Curriculum Vitae - Continued</p>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="body-continued">',
    continuedSections,
    '</section>',
    '</section>',
  ].join('')
}

function buildSectionMarkup(section: AdaptedCvPageSection): string {
  switch (section.kind) {
    case 'experience': {
      const label = section.isContinued ? 'EXPERIENCE (CONTINUED)' : 'EXPERIENCE'
      const itemsMarkup = section.items
        .map((item) => {
          const bulletsMarkup = item.bullets
            .map((bullet) => {
              return [
                '<div class="bullet-row">',
                '<span class="bullet-mark">•</span>',
                `<span class="bullet-text">${escapeHtml(bullet.text)}</span>`,
                '</div>',
              ].join('')
            })
            .join('')

          return [
            '<article class="experience-item">',
            `<p class="exp-title">${escapeHtml(buildExperienceTitle(item))}</p>`,
            `<p class="exp-meta">${escapeHtml(buildExperienceMeta(item))}</p>`,
            bulletsMarkup,
            '</article>',
          ].join('')
        })
        .join('')

      return [
        `<section class="${section.isContinued ? 'section-experience-continued' : 'section-experience'}">`,
        `<h2 class="section-label">${label}</h2>`,
        '<div class="experience-list">',
        itemsMarkup,
        '</div>',
        '</section>',
      ].join('')
    }

    case 'core_skills':
    case 'tools':
    case 'certifications':
    case 'languages':
    case 'focus': {
      const skillsMarkup = section.items
        .map((skill) => {
          return `<p class="sidebar-line">${escapeHtml(skill)}</p>`
        })
        .join('')
      const label = buildSidebarSectionLabel(section.kind)

      return [
        '<section class="sidebar-section-gap-8">',
        `<h2 class="section-label">${label}</h2>`,
        skillsMarkup,
        '</section>',
      ].join('')
    }

    case 'education': {
      return [
        '<section class="sidebar-section-gap-8">',
        '<h2 class="section-label">EDUCATION</h2>',
        `<p class="edu-title">${escapeHtml(section.entry.title)}</p>`,
        `<p class="edu-meta">${escapeHtml(section.entry.meta)}</p>`,
        '</section>',
      ].join('')
    }

    case 'references': {
      return [
        '<section class="sidebar-section-gap-8">',
        '<h2 class="section-label">REFERENCES</h2>',
        '<p class="sidebar-line">Available on request</p>',
        '</section>',
      ].join('')
    }

    case 'selected_work':
    case 'impact_highlights': {
      const label = section.kind === 'selected_work' ? 'SELECTED WORK' : 'IMPACT HIGHLIGHTS'
      const headingLabel = section.isContinued ? `${label} (CONTINUED)` : label
      const itemsMarkup = section.items
        .map((item) => {
          return `<p class="section-line">${escapeHtml(item)}</p>`
        })
        .join('')

      return [
        '<section class="section-text-block">',
        `<h2 class="section-label">${headingLabel}</h2>`,
        itemsMarkup,
        '</section>',
      ].join('')
    }

    case 'profile': {
      return [
        '<section class="section-profile">',
        '<h2 class="section-label">PROFILE</h2>',
        `<p class="profile-text">${escapeHtml(section.text)}</p>`,
        '</section>',
      ].join('')
    }
  }
}

function buildPageWarning(pageCount: number): string {
  return `This adapted CV runs to ${String(pageCount)} pages. Export is still available.`
}

function buildExperienceMeta(item: AdaptedCvExperienceEntry): string {
  return [item.location, item.dateRange]
    .filter((value): value is string => {
      return value !== null && value.trim() !== ''
    })
    .join(' · ')
}

function buildExperienceTitle(item: AdaptedCvExperienceEntry): string {
  return [item.roleTitle, item.employer]
    .filter((value) => {
      return value.trim() !== ''
    })
    .join(' · ')
}

function sanitizeFilenamePart(value: string): string {
  const collapsedWhitespace = value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(SAFE_FILENAME_CHARACTER, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')

  return collapsedWhitespace === '' ? 'adapted-cv' : collapsedWhitespace
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
    h2,
    p {
      margin: 0;
    }

    .cv-page {
      width: 794px;
      height: 1123px;
      margin: 0 auto;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      break-after: page;
      page-break-after: always;
    }

    .cv-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    .page-1 {
      gap: 34px;
      padding: 52px 58px;
    }

    .header-main {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
    }

    .identity-main {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .name-main {
      font-size: 44px;
      line-height: 1;
      letter-spacing: 0.4px;
      font-weight: 600;
    }

    .role-main {
      color: var(--text-muted);
      font-size: 20px;
      line-height: 1.1;
      font-weight: 500;
    }

    .intro-main {
      max-width: 430px;
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.45;
    }

      .contact-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
      width: 250px;
      flex: 0 0 250px;
    }

    .contact-list p {
      color: var(--text-primary);
      text-align: right;
      font-size: 12px;
      line-height: 1.3;
    }

    .divider {
      width: 100%;
      height: 0;
      border-top: 1px solid var(--divider);
    }

    .body-continued {
      display: flex;
      flex-direction: column;
      gap: 20px;
      flex: 1 1 auto;
      min-height: 0;
    }

    .body-main {
      display: flex;
      gap: 38px;
      align-items: flex-start;
      flex: 1 1 auto;
      min-height: 0;
    }

    .left-col {
      display: flex;
      flex-direction: column;
      gap: 28px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .right-col {
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 232px;
      min-width: 232px;
    }

    .section-label {
      color: var(--text-subtle);
      text-transform: uppercase;
      font-size: 11px;
      line-height: 1;
      letter-spacing: 1.6px;
      font-weight: 600;
    }

    .section-profile,
    .section-experience,
    .section-experience-continued,
    .section-text-block,
    .sidebar-section-gap-8 {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .profile-text {
      color: var(--text-primary);
      font-size: 13px;
      line-height: 1.65;
    }

    .experience-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .experience-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .exp-title {
      color: var(--text-primary);
      font-size: 14px;
      line-height: 1.2;
      font-weight: 600;
    }

    .exp-meta {
      color: var(--text-subtle);
      font-size: 12px;
      line-height: 1.333333;
      font-weight: 400;
    }

    .bullet-row {
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }

    .bullet-mark,
    .bullet-text {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .sidebar-line {
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.333333;
      font-weight: 400;
    }

    .edu-title {
      color: var(--text-primary);
      font-size: 13px;
      line-height: normal;
      font-weight: 600;
    }

    .edu-meta {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .section-line {
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1.6;
      font-weight: 400;
    }

    .header-continued {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 36px 58px 0;
    }

    .name-continued {
      font-size: 24px;
      line-height: 1;
      letter-spacing: 0.2px;
      font-weight: 600;
    }

    .role-continued {
      color: var(--text-subtle);
      font-size: 13px;
      line-height: 1.2;
      font-weight: 500;
    }

    .intro-continued {
      color: var(--text-subtle);
      font-size: 11px;
      line-height: 1.4;
    }

    .page-2,
    .page-3,
    .page-4,
    .page-5,
    .page-6 {
      gap: 24px;
      padding: 36px 58px 52px;
    }
  `
}

function buildHeaderContactLines(contact: AdaptedCvModel['header']['contact']): string[] {
  return [contact.location, contact.phone, contact.email, contact.professionalLink].filter(
    (value): value is string => {
      return value !== null && value.trim() !== ''
    },
  )
}

function createSidebarListSection(
  section: Extract<
    AdaptedCvSection,
    { kind: 'certifications' | 'focus' | 'languages' | 'tools' }
  > | null,
  kind: 'certifications' | 'focus' | 'languages' | 'tools',
): AdaptedCvPageSection[] {
  if (section === null || section.items.length === 0) {
    return []
  }

  return [
    {
      items: section.items.map((item) => {
        return item.text
      }),
      kind,
    },
  ]
}

function buildSidebarSectionLabel(
  kind: 'core_skills' | 'certifications' | 'focus' | 'languages' | 'tools',
): string {
  switch (kind) {
    case 'core_skills': {
      return 'CORE SKILLS'
    }

    case 'tools': {
      return 'TOOLS'
    }

    case 'certifications': {
      return 'CERTIFICATIONS'
    }

    case 'languages': {
      return 'LANGUAGES'
    }

    case 'focus': {
      return 'FOCUS'
    }
  }
}
