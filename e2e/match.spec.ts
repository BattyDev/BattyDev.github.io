import { expect, test, type Page } from '@playwright/test';

// Plays a whole match through the interface, choosing the first sensible
// option at every prompt, to prove nothing in the UI can dead-end a game.

async function fastSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('batty-gwent:settings', JSON.stringify({ speed: 'instant', confirmPass: false }));
  });
}

test('a full match can be played to the end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fastSettings(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start match' }).click();

  for (let step = 0; step < 300; step++) {
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      const title = (await dialog.getAttribute('aria-label')) ?? '';
      if (/Victory|Defeat|Draw/.test(title)) {
        await expect(dialog.getByRole('button', { name: 'Rematch' })).toBeVisible();
        expect(errors).toEqual([]);
        return;
      }
      if (/Redraw/.test(title)) {
        await dialog.getByRole('button', { name: 'Keep this hand' }).click();
        continue;
      }
      if (/goes first/.test(title)) {
        await dialog.getByRole('button', { name: /go first/ }).click();
        continue;
      }
      // A pending choice: a card to pick, or a row button.
      const pick = dialog.locator('.card.pick, .pick-rows .btn').first();
      await pick.click();
      continue;
    }
    const status = (await page.locator('.status').textContent()) ?? '';
    if (!status.includes('Your turn')) {
      await page.waitForTimeout(50);
      continue;
    }
    const cards = page.locator('.hand .card:not([disabled])');
    // Play a few cards each round, then pass, so rounds actually end.
    const handSize = await cards.count();
    if (handSize === 0 || (step % 5 === 4)) {
      await page.getByRole('button', { name: 'Pass' }).click();
      continue;
    }
    await cards.first().click();
    const target = page.locator('.row.target, .card.target, .weather.target').first();
    const primary = page.locator('.controls .btn.primary');
    if (await target.count()) await target.click();
    else if (await primary.count()) await primary.click();
    else await page.getByRole('button', { name: 'Pass' }).click();
  }
  throw new Error('match did not finish');
});

test('undo takes back a move', async ({ page }) => {
  await fastSettings(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start match' }).click();
  const keep = page.getByRole('button', { name: 'Keep this hand' });
  await keep.click();
  await expect(page.locator('.status')).toHaveText('Your turn', { timeout: 15000 });
  const before = await page.locator('.hand .card').count();
  await page.locator('.hand .card').first().click();
  const target = page.locator('.row.target, .card.target, .weather.target').first();
  if (await target.count()) await target.click();
  else await page.locator('.controls .btn.primary').click();
  await expect(page.locator('.status')).toHaveText('Your turn', { timeout: 15000 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.hand .card')).toHaveCount(before);
});
