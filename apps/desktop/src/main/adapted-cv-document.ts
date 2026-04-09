import type {
  AdaptedCvExperienceHighlight,
  AdaptedCvModel,
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
  sections: AdaptedCvSection[]
}

type AdaptedCvSection =
  | {
      kind: 'experience'
      isContinued: boolean
      items: AdaptedCvExperienceHighlight[]
    }
  | {
      kind: 'profile'
      text: string
    }
  | {
      kind: 'skills'
      items: string[]
    }

export interface AdaptedCvDocument {
  html: string
  pageCount: number
  pageWarning: string | null
}

export function createAdaptedCvDocument(input: AdaptedCvDocumentInput): AdaptedCvDocument {
  const pages = paginateAdaptedCv(input)
  const html = buildDocumentHtml({
    pages,
    roleLabel: input.adaptedCv.headline.text,
    subtitleLabel: buildSubtitleLabel(input),
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
  const remainingExperience = [...input.adaptedCv.experienceHighlights]
  const remainingSkills = input.adaptedCv.skills.map((skill) => {
    return skill.text
  })
  const pages: AdaptedCvPage[] = []
  const firstPageSections: AdaptedCvSection[] = [
    {
      kind: 'profile',
      text: input.adaptedCv.summary.text,
    },
  ]

  let firstPageCapacity = PAGE_ONE_CAPACITY - estimateProfileHeight(input.adaptedCv.summary.text)

  const firstPageExperience = takeExperienceItems(remainingExperience, firstPageCapacity)

  if (firstPageExperience.length > 0) {
    firstPageSections.push({
      items: firstPageExperience,
      isContinued: false,
      kind: 'experience',
    })
    firstPageCapacity -= estimateExperienceSectionHeight(firstPageExperience, false)
  }

  const firstPageSkills = takeSkillItems(remainingSkills, Math.max(firstPageCapacity, 8))

  if (firstPageSkills.length > 0) {
    firstPageSections.push({
      items: firstPageSkills,
      kind: 'skills',
    })
  }

  pages.push({
    kind: 'main',
    sections: firstPageSections,
  })

  while (remainingExperience.length > 0 || remainingSkills.length > 0) {
    const continuedPageSections: AdaptedCvSection[] = []
    let continuedPageCapacity = CONTINUED_PAGE_CAPACITY

    if (remainingExperience.length > 0) {
      const continuedExperience = takeExperienceItems(remainingExperience, continuedPageCapacity)

      if (continuedExperience.length > 0) {
        continuedPageSections.push({
          items: continuedExperience,
          isContinued: true,
          kind: 'experience',
        })
        continuedPageCapacity -= estimateExperienceSectionHeight(continuedExperience, true)
      }
    }

    if (remainingSkills.length > 0) {
      const continuedSkills = takeSkillItems(remainingSkills, Math.max(continuedPageCapacity, 8))

      if (continuedSkills.length > 0) {
        continuedPageSections.push({
          items: continuedSkills,
          kind: 'skills',
        })
      }
    }

    pages.push({
      kind: 'continued',
      sections: continuedPageSections,
    })
  }

  return pages
}

function estimateProfileHeight(summaryText: string): number {
  return 5 + Math.ceil(summaryText.length / 150)
}

function estimateExperienceSectionHeight(
  items: AdaptedCvExperienceHighlight[],
  isContinued: boolean,
): number {
  const headingHeight = isContinued ? 3 : 4
  const itemsHeight = items.reduce((totalHeight, item) => {
    const headingHeight = 3
    const bulletsHeight = item.bullets.reduce((totalBulletHeight, bullet) => {
      return totalBulletHeight + 2 + Math.ceil(bullet.text.length / 110)
    }, 0)

    return totalHeight + headingHeight + bulletsHeight
  }, 0)

  return headingHeight + itemsHeight
}

function estimateSkillSectionHeight(skills: string[]): number {
  return (
    3 +
    skills.reduce((totalHeight, skill) => {
      return totalHeight + 1 + Math.ceil(skill.length / 28)
    }, 0)
  )
}

function takeExperienceItems(
  remainingExperience: AdaptedCvExperienceHighlight[],
  availableHeight: number,
): AdaptedCvExperienceHighlight[] {
  const selectedItems: AdaptedCvExperienceHighlight[] = []
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

function takeSkillItems(remainingSkills: string[], availableHeight: number): string[] {
  const selectedItems: string[] = []
  let consumedHeight = 0

  while (remainingSkills.length > 0) {
    const nextSkill = remainingSkills[0]

    if (nextSkill === undefined) {
      break
    }

    const nextSkillHeight = estimateSkillSectionHeight([nextSkill])

    if (selectedItems.length > 0 && consumedHeight + nextSkillHeight > availableHeight) {
      break
    }

    selectedItems.push(nextSkill)
    consumedHeight += nextSkillHeight
    remainingSkills.shift()
  }

  if (selectedItems.length === 0 && remainingSkills.length > 0) {
    const forcedSkill = remainingSkills.shift()

    if (forcedSkill !== undefined) {
      selectedItems.push(forcedSkill)
    }
  }

  return selectedItems
}

function buildDocumentHtml({
  pages,
  roleLabel,
  subtitleLabel,
  title,
}: {
  pages: AdaptedCvPage[]
  roleLabel: string
  subtitleLabel: string
  title: string
}): string {
  const pageMarkup = pages
    .map((page, pageIndex) => {
      return page.kind === 'main'
        ? buildMainPageMarkup({
            page,
            roleLabel,
            subtitleLabel,
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
  page,
  roleLabel,
  subtitleLabel,
  title,
}: {
  page: AdaptedCvPage
  roleLabel: string
  subtitleLabel: string
  title: string
}): string {
  const profileSection = page.sections.find((section) => {
    return section.kind === 'profile'
  })
  const mainSections = page.sections
    .filter((section) => {
      return section.kind !== 'profile'
    })
    .map((section) => {
      return buildSectionMarkup(section)
    })
    .join('')

  const profileMarkup =
    profileSection?.kind === 'profile'
      ? [
          '<section class="section-profile">',
          '<h2 class="section-label">PROFILE</h2>',
          `<p class="profile-text">${escapeHtml(profileSection.text)}</p>`,
          '</section>',
        ].join('')
      : ''

  return [
    '<section class="cv-page page-1">',
    '<header class="header-main">',
    '<section class="identity-main">',
    `<h1 class="name-main">${escapeHtml(title)}</h1>`,
    `<p class="role-main">${escapeHtml(roleLabel)}</p>`,
    `<p class="intro-main">${escapeHtml(subtitleLabel)}</p>`,
    '</section>',
    '<section class="contact-list">',
    '<p>Adapted CV</p>',
    '<p>PDF preview artifact</p>',
    '</section>',
    '</header>',
    '<div class="divider"></div>',
    '<section class="body-main">',
    '<section class="left-col">',
    profileMarkup,
    mainSections,
    '</section>',
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
  const continuedSections = page.sections
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

function buildSectionMarkup(section: AdaptedCvSection): string {
  if (section.kind === 'experience') {
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
          `<p class="exp-title">${escapeHtml(item.heading)}</p>`,
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

  if (section.kind === 'skills') {
    const skillsMarkup = section.items
      .map((skill) => {
        return `<p class="sidebar-line">${escapeHtml(skill)}</p>`
      })
      .join('')

    return [
      '<section class="sidebar-section-gap-8">',
      '<h2 class="section-label">CORE SKILLS</h2>',
      skillsMarkup,
      '</section>',
    ].join('')
  }

  return [
    '<section class="section-profile">',
    '<h2 class="section-label">PROFILE</h2>',
    `<p class="profile-text">${escapeHtml(section.text)}</p>`,
    '</section>',
  ].join('')
}

function buildSubtitleLabel(input: AdaptedCvDocumentInput): string {
  const summaryBits = [input.vacancyTitle, input.employer].filter((value): value is string => {
    return value !== null && value.trim() !== ''
  })

  if (summaryBits.length === 0) {
    return 'Tailored for the selected job vacancy.'
  }

  return `Tailored for ${summaryBits.join(' · ')}.`
}

function buildPageWarning(pageCount: number): string {
  return `This adapted CV runs to ${String(pageCount)} pages. Export is still available.`
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
      min-width: 180px;
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

    .body-main,
    .body-continued {
      display: flex;
      flex-direction: column;
      gap: 24px;
      flex: 1 1 auto;
    }

    .left-col {
      display: flex;
      flex-direction: column;
      gap: 24px;
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

    .bullet-row {
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }

    .bullet-mark,
    .bullet-text,
    .sidebar-line {
      color: var(--text-muted);
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
