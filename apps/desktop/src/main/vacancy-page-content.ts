const MAX_NORMALIZATION_HTML_LENGTH = 60_000
const MAX_NORMALIZATION_TEXT_LENGTH = 24_000
const PRIMARY_CONTENT_BLOCK_PATTERN = /<(main|article)\b[^>]*>[\s\S]*?<\/\1>/giu
const TRAILING_RELATED_CONTENT_MARKERS = [
  /recommended jobs/iu,
  /similar jobs/iu,
  /people also viewed/iu,
  /more jobs/iu,
  /jobs you may be interested in/iu,
] as const

export interface VacancyNormalizationArtifacts {
  extractedText: string
  sanitizedHtml: string
}

export function extractTextFromHtml(html: string): string {
  const strippedHtml = html
    .replaceAll(/<head[\s\S]*?<\/head>/gi, ' ')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|br)>/gi, '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/gi, "'")
    .replaceAll(/\s+\n/g, '\n')
    .replaceAll(/\n{2,}/g, '\n')

  return strippedHtml.trim()
}

export function sanitizeSnapshotHtml(html: string): string {
  return html
    .replaceAll(/<head[\s\S]*?<\/head>/gi, ' ')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replaceAll(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replaceAll(/<form[\s\S]*?<\/form>/gi, ' ')
    .replaceAll(/<input[^>]*>/gi, ' ')
    .replaceAll(/<textarea[\s\S]*?<\/textarea>/gi, ' ')
    .replaceAll(/<select[\s\S]*?<\/select>/gi, ' ')
    .replaceAll(
      /localStorage|sessionStorage|document\.cookie|sessionToken|accessToken|refreshToken/gi,
      '',
    )
    .replaceAll(/\b(?:authorization|set-cookie|cookie)\b/gi, '')
}

export function prepareVacancyNormalizationArtifacts({
  html,
}: {
  html: string
}): VacancyNormalizationArtifacts {
  const sanitizedHtml = sanitizeSnapshotHtml(html)
  const focusedHtml = focusNormalizationHtml(sanitizedHtml)
  const boundedHtml = truncateContent(focusedHtml, MAX_NORMALIZATION_HTML_LENGTH)
  const extractedText = truncateContent(
    extractTextFromHtml(boundedHtml),
    MAX_NORMALIZATION_TEXT_LENGTH,
  )

  return {
    extractedText,
    sanitizedHtml: boundedHtml,
  }
}

export function inferPageTitle(html: string): string | null {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html)

  if (titleMatch === null) {
    return null
  }

  const [, title] = titleMatch

  if (title === undefined) {
    return null
  }

  return title.trim()
}

export function inferTitleFromPageTitle(pageTitle: string | null): string | null {
  if (pageTitle === null) {
    return null
  }

  const normalizedTitle = pageTitle.split(/\s+(?:at|\|)\s+/i)[0]

  if (normalizedTitle === undefined) {
    return null
  }

  return normalizedTitle.trim()
}

function focusNormalizationHtml(html: string): string {
  const primaryContent = extractPrimaryContentBlock(html)

  if (primaryContent === null) {
    return html
  }

  const embeddedFrameContent = extractEmbeddedFrameContent(html)
  const focusedHtml =
    embeddedFrameContent === '' ? primaryContent : `${primaryContent}\n${embeddedFrameContent}`

  return trimTrailingRelatedContent(focusedHtml)
}

function extractPrimaryContentBlock(html: string): string | null {
  const matches = [...html.matchAll(PRIMARY_CONTENT_BLOCK_PATTERN)]
    .map((match) => {
      return match[0].trim()
    })
    .filter((match) => {
      return match !== ''
    })

  if (matches.length === 0) {
    return null
  }

  return matches.reduce((longestMatch, candidate) => {
    return candidate.length > longestMatch.length ? candidate : longestMatch
  })
}

function trimTrailingRelatedContent(html: string): string {
  const markerIndexes = TRAILING_RELATED_CONTENT_MARKERS.map((pattern) => {
    return html.search(pattern)
  }).filter((index) => {
    return index >= 0
  })

  if (markerIndexes.length === 0) {
    return html
  }

  const markerIndex = Math.min(...markerIndexes)
  const containerCutIndex = [
    html.lastIndexOf('<section', markerIndex),
    html.lastIndexOf('<aside', markerIndex),
    html.lastIndexOf('<div', markerIndex),
  ].reduce((largestIndex, candidateIndex) => {
    return Math.max(largestIndex, candidateIndex)
  }, -1)
  const cutIndex = containerCutIndex >= 0 ? containerCutIndex : markerIndex

  return html.slice(0, cutIndex).trim()
}

function extractEmbeddedFrameContent(html: string): string {
  return [
    ...html.matchAll(
      /<section\b[^>]*\bdata-cv-maxxing-embedded-frame="[^"]*"[^>]*>[\s\S]*?<\/section>/giu,
    ),
  ]
    .map((match) => {
      return match[0].trim()
    })
    .filter((match) => {
      return match !== ''
    })
    .join('\n')
}

function truncateContent(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return value.slice(0, maxLength).trimEnd()
}
