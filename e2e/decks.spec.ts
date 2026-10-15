import { expect, test } from '@playwright/test';

test('build, save, share and re-import a deck, then play with it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/decks/new-mine');
  const cards = page.locator('.pool-card .card');
  for (let i = 0; i < 24; i++) await cards.nth(i).click();
  await expect(page.getByText('Legal deck.')).toBeVisible();
  await page.locator('.deck-name').fill('E2E deck');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const code = await page.locator('input[aria-label="Deck code"]').inputValue();
  expect(code.startsWith('GW1.')).toBe(true);

  await page.goto('./#/decks');
  await expect(page.getByText('E2E deck')).toBeVisible();
  await page.getByPlaceholder('Paste a deck code (GW1.…)').fill(code);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.deck-name')).toHaveValue('E2E deck');

  await page.goto('./#/');
  await page.getByRole('button', { name: /E2E deck/ }).first().click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByRole('dialog', { name: /Redraw/ }).or(page.getByText(/thinking/))).toBeVisible();
  expect(errors).toEqual([]);
});
