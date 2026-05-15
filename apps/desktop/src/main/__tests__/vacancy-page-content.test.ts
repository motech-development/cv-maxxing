import { expect, test } from 'vitest'

import { inferTitleFromPageTitle } from '../vacancy-page-content.js'

test('infers vacancy titles from generic job page titles without provider-specific suffix rules', () => {
  expect(inferTitleFromPageTitle('Senior Product Designer - Example Careers')).toBe(
    'Senior Product Designer',
  )
  expect(inferTitleFromPageTitle('Staff Product Designer | Example Jobs')).toBe(
    'Staff Product Designer',
  )
  expect(inferTitleFromPageTitle('Principal Designer at Example Labs')).toBe('Principal Designer')
})
