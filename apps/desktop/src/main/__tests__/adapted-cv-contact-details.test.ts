import { expect, test } from 'vitest'

import { extractAdaptedCvHeaderContact } from '../adapted-cv-contact-details.js'

test('extracts header contact details from original CV text using the agreed priority order', () => {
  const result = extractAdaptedCvHeaderContact(
    [
      'Ada Lovelace',
      'Principal Product Designer',
      'London, United Kingdom',
      '+44 7700 900123',
      'ada@lovelace.dev',
      'https://www.linkedin.com/in/ada-lovelace',
      'https://github.com/ada-lovelace',
      'ada-lovelace.dev',
    ].join('\n'),
  )

  expect(result).toEqual({
    email: 'ada@lovelace.dev',
    location: 'London, United Kingdom',
    phone: '+44 7700 900123',
    professionalLink: 'ada-lovelace.dev',
  })
})
