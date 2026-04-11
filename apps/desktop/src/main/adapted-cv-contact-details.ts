import type { AdaptedCvHeaderContact } from '../shared/tailored-application.js'

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
const PHONE_PATTERN = /(?:\+\d[\d\s().-]{7,}\d|\(\+\d+\)\s*[\d\s.-]{6,}\d)/u
const URL_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/giu
const LINKEDIN_PATTERN = /linkedin\.com/iu
const GITHUB_PATTERN = /github\.com/iu

export function extractAdaptedCvHeaderContact(originalCvText: string): AdaptedCvHeaderContact {
  const trimmedLines = originalCvText
    .split(/\r?\n/u)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return line !== ''
    })

  const email = EMAIL_PATTERN.exec(originalCvText)?.[0] ?? null
  const phone = PHONE_PATTERN.exec(originalCvText)?.[0] ?? null
  const emailDomain = extractEmailDomain(email)
  const professionalLink = pickProfessionalLink(
    [...originalCvText.matchAll(URL_PATTERN)]
      .map((match) => {
        return match[0]
      })
      .filter((match) => {
        return emailDomain === null || extractLinkHost(match) !== emailDomain
      }),
  )
  const location = pickLocation(trimmedLines, {
    email,
    phone,
    professionalLink,
  })

  return {
    email,
    location,
    phone,
    professionalLink,
  }
}

function pickProfessionalLink(matches: string[]): string | null {
  const uniqueMatches = [
    ...new Set(
      matches.map((match) => {
        return normalizeUrl(match)
      }),
    ),
  ]

  const portfolioLink = uniqueMatches.find((match) => {
    return !LINKEDIN_PATTERN.test(match) && !GITHUB_PATTERN.test(match)
  })

  if (portfolioLink !== undefined) {
    return portfolioLink
  }

  const linkedInLink = uniqueMatches.find((match) => {
    return LINKEDIN_PATTERN.test(match)
  })

  if (linkedInLink !== undefined) {
    return linkedInLink
  }

  const githubLink = uniqueMatches.find((match) => {
    return GITHUB_PATTERN.test(match)
  })

  return githubLink ?? null
}

function pickLocation(
  lines: string[],
  excludedValues: {
    email: string | null
    phone: string | null
    professionalLink: string | null
  },
): string | null {
  const blockedValues = new Set(
    [excludedValues.email, excludedValues.phone, excludedValues.professionalLink].filter(
      (value): value is string => {
        return value !== null
      },
    ),
  )

  return (
    lines.find((line, index) => {
      if (index > 5 || blockedValues.has(line)) {
        return false
      }

      return (
        line.includes(',') &&
        !EMAIL_PATTERN.test(line) &&
        !PHONE_PATTERN.test(line) &&
        !URL_PATTERN.test(line)
      )
    }) ?? null
  )
}

function normalizeUrl(value: string): string {
  return value.replace(/^https?:\/\//iu, '').replace(/^www\./iu, '')
}

function extractEmailDomain(email: string | null): string | null {
  return email?.split('@')[1] ?? null
}

function extractLinkHost(value: string): string {
  const parsedUrl = new URL(value.startsWith('http') ? value : `https://${value}`)

  return parsedUrl.hostname.replace(/^www\./iu, '')
}
