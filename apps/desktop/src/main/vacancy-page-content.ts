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

  const normalizedTitle = pageTitle
    .replace(/\s+-\s+Greenhouse$/i, '')
    .replace(/\s+\|\s+Indeed$/i, '')
    .replace(/\s+\|\s+LinkedIn$/i, '')
    .split(/\s+(?:at|\|)\s+/i)[0]

  if (normalizedTitle === undefined) {
    return null
  }

  return normalizedTitle.trim()
}
