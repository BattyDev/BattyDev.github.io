import { expect, test } from '@playwright/test';

test('menu loads with every faction and starts a match', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Gwent' })).toBeVisible();
  for (const f of ['Northern Realms', 'Nilfgaardian Empire', 'Monsters', "Scoia'tael", 'Skellige']) {
    await expect(page.getByRole('radio', { name: f }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Start match' }).click();
  // Either the redraw prompt (we act first) or the opponent redrawing.
  await expect(page.getByRole('dialog', { name: /Redraw/ }).or(page.getByText(/thinking/))).toBeVisible();
  expect(errors).toEqual([]);
});
