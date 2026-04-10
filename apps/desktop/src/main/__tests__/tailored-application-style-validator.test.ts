import { expect, test } from 'vitest'

import {
  INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE,
  type WritingStyleProfile,
  parseWritingStyleProfileJson,
} from '../tailored-application-style-validator.js'

const directWritingStyleProfile: WritingStyleProfile = {
  averageSentenceLength: 7,
  clicheDetections: ['passionate', 'world-class'],
  firstPersonUsage: 'absent',
  formality: 'direct',
}

test('parses a valid stored writing-style profile JSON payload', () => {
  expect(parseWritingStyleProfileJson(JSON.stringify(directWritingStyleProfile))).toEqual(
    directWritingStyleProfile,
  )
})

test('rejects an invalid stored writing-style profile JSON payload', () => {
  expect(() => {
    parseWritingStyleProfileJson(
      JSON.stringify({
        ...directWritingStyleProfile,
        averageSentenceLength: 'seven',
      }),
    )
  }).toThrow(INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE)
})

test('rejects malformed stored writing-style profile JSON payloads', () => {
  expect(() => {
    parseWritingStyleProfileJson('{"averageSentenceLength":')
  }).toThrow(INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE)
})
