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

test('preserves dashed role qualifiers when inferring generic vacancy titles', () => {
  expect(inferTitleFromPageTitle('Product Manager - AI Platform - Example Careers')).toBe(
    'Product Manager - AI Platform',
  )
  expect(inferTitleFromPageTitle('Software Engineer - Platform')).toBe(
    'Software Engineer - Platform',
  )
  expect(inferTitleFromPageTitle('Product Manager - AI Platform at Example Labs')).toBe(
    'Product Manager - AI Platform',
  )
})
