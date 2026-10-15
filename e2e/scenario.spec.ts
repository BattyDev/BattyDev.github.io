import { expect, test } from '@playwright/test';

test('lay out a scenario, play it, and share it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('batty-gwent:settings', JSON.stringify({ speed: 'instant', confirmPass: false })));
  await page.goto('./#/scenario');
  await page.getByRole('button', { name: 'Clear' }).click();
  // Two cards in your hand, one unit on your close row.
  await page.getByRole('button', { name: 'Add a card to your hand' }).click();
  const picks = page.getByRole('dialog').locator('.card.pick');
  await picks.nth(0).click();
  await picks.nth(1).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add a card to this row' }).nth(3).click();
  await page.getByRole('dialog').locator('.card.pick').first().click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Biting Frost').check();

  const code = await page.getByLabel('Scenario code', { exact: true }).inputValue();
  expect(code.startsWith('GS1.')).toBe(true);

  await page.getByRole('button', { name: 'Play from here' }).click();
  await expect(page.locator('.status')).toHaveText('Your turn', { timeout: 20000 });
  await expect(page.locator('.hand .card')).toHaveCount(2);
  await expect(page.locator('.half.me .row').first()).toHaveClass(/weather-close/);

  // The same position loads from a link.
  await page.goto(`./#/scenario/${encodeURIComponent(code)}`);
  await expect(page.getByText(/Loaded/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('exam mode hides the coach and undo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('batty-gwent:settings', JSON.stringify({ speed: 'instant', confirmPass: false })));
  await page.goto('./');
  await page.getByLabel(/Exam mode/).check();
  await page.getByRole('button', { name: 'Start match' }).click();
  await page.getByRole('button', { name: 'Keep this hand' }).click();
  await expect(page.locator('.status')).toHaveText('Your turn', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Coach' })).toHaveCount(0);
  await expect(page.getByText('Exam', { exact: true })).toBeVisible();
});

test('a match in progress survives a reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('batty-gwent:settings', JSON.stringify({ speed: 'instant', confirmPass: false })));
  await page.goto('./');
  await page.getByRole('button', { name: 'Start match' }).click();
  await page.getByRole('button', { name: 'Keep this hand' }).click();
  await expect(page.locator('.status')).toHaveText('Your turn', { timeout: 20000 });
  await page.locator('.hand .card:not(.unplayable)').first().click();
  const target = page.locator('.row.target, .card.target, .weather.target').first();
  if (await target.count()) await target.click();
  else await page.locator('.controls .btn.primary').click();
  for (let i = 0; i < 4; i++) {
    const pick = page.getByRole('dialog').locator('.card.pick, .pick-rows .btn').first();
    if (!(await pick.count())) break;
    await pick.click();
  }
  await expect(page.locator('.status')).toHaveText(/Your turn|Match over/, { timeout: 20000 });
  const hand = await page.locator('.hand .card').count();
  await page.reload();
  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(page.locator('.hand .card')).toHaveCount(hand);
});
