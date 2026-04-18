import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function expectActiveOriginalCv(page: Page, filename: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Your CV' })).toBeVisible()
  await expect(page.getByText('Extracted profile')).toBeVisible()
  await expect(page.getByText(filename)).toBeVisible()
}

export async function importOriginalCvFromFirstLaunch({
  filename,
  filePath,
  page,
}: {
  filename: string
  filePath: string
  page: Page
}): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible()
  await page.getByLabel('Your CV file').setInputFiles(filePath)
  await page.getByRole('button', { name: 'Add a CV' }).click()
  await expectActiveOriginalCv(page, filename)
}

export async function openOriginalCvReplacementScreen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a CV' }).click()
  await expect(page.getByRole('heading', { name: 'Add a CV' })).toBeVisible()
  await expect(
    page.getByText("Replacing your CV changes the one you'll use for new jobs."),
  ).toBeVisible()
}

export async function openJobsFromYourCv(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Jobs' }).click()
  await expect(page.getByRole('heading', { name: 'Add a job' })).toBeVisible()
}

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
}

export async function openLocalDataSettings(page: Page): Promise<void> {
  await openSettings(page)
  await page.getByRole('button', { name: 'Show Local data settings' }).click()
  await expect(page.getByRole('heading', { name: 'Local data' })).toBeVisible()
}

export async function reviewPastedVacancy({
  page,
  vacancyText,
}: {
  page: Page
  vacancyText: string
}): Promise<void> {
  await page.getByLabel('Job description').fill(vacancyText)
  await page.getByLabel('Job description').press('Tab')
  await page.getByRole('button', { name: 'Check job details' }).nth(1).dispatchEvent('click')
  await expect(page.getByText(/Job (details|preview)/)).toBeVisible()
}

export async function createTailoredApplicationFromPastedVacancy({
  expectPreview = true,
  page,
  vacancyText,
  expectedTitle = 'Senior platform engineer',
}: {
  expectPreview?: boolean
  expectedTitle?: string
  page: Page
  vacancyText: string
}): Promise<void> {
  await reviewPastedVacancy({
    page,
    vacancyText,
  })
  await page.getByRole('button', { name: 'Tailor your CV' }).click()
  await expect(page.getByRole('heading', { name: expectedTitle })).toBeVisible({
    timeout: 15_000,
  })

  if (!expectPreview) {
    return
  }

  await expect(page.getByLabel('CV PDF preview')).toBeVisible({
    timeout: 15_000,
  })
}
