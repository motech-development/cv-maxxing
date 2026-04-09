import { expect, test } from 'vitest'

import {
  type WritingStyleProfile,
  validateTailoredApplicationWritingStyle,
} from '../tailored-application-style-validator.js'

const directWritingStyleProfile: WritingStyleProfile = {
  averageSentenceLength: 7,
  clicheDetections: ['passionate', 'world-class'],
  firstPersonUsage: 'absent',
  formality: 'direct',
}

test('accepts generated output that stays close to the stored writing-style profile', () => {
  expect(() => {
    validateTailoredApplicationWritingStyle({
      adaptedCvText: [
        'Principal Product Designer for desktop workflow products',
        'Design leader adapting complex desktop workflow products for technical users.',
        'Led product design for AI-assisted desktop tooling used by technical teams.',
      ].join('\n'),
      coverLetterText: [
        'I am applying for the Senior platform engineer role at Example Labs.',
        'I have led product design for AI-assisted desktop tooling, which aligns with your focus on reliable tooling for technical users.',
        'I would welcome the chance to discuss how that experience could support Example Labs.',
      ].join('\n'),
      profile: directWritingStyleProfile,
    })
  }).not.toThrow()
})

test('rejects generated output that reintroduces the original CV cliche blacklist', () => {
  expect(() => {
    validateTailoredApplicationWritingStyle({
      adaptedCvText: [
        'Principal Product Designer for desktop workflow products',
        'Design leader adapting complex desktop workflow products for technical users.',
      ].join('\n'),
      coverLetterText: [
        'I am excited to apply for the Senior platform engineer role at Example Labs.',
        'I am passionate about joining your world-class team and bringing a results-driven approach to the role.',
        'I would welcome the chance to discuss how that experience could support Example Labs.',
      ].join('\n'),
      profile: directWritingStyleProfile,
    })
  }).toThrow('Generated tailored application failed style validation.')
})

test('rejects adapted CV output that drifts into first-person copy when the original CV is impersonal', () => {
  expect(() => {
    validateTailoredApplicationWritingStyle({
      adaptedCvText: [
        'Principal Product Designer for desktop workflow products',
        'I led product design for AI-assisted desktop tooling used by technical teams.',
      ].join('\n'),
      coverLetterText: [
        'I am applying for the Senior platform engineer role at Example Labs.',
        'I have led product design for AI-assisted desktop tooling.',
        'I would welcome the chance to discuss how that experience could support Example Labs.',
      ].join('\n'),
      profile: directWritingStyleProfile,
    })
  }).toThrow('Generated tailored application failed style validation.')
})
