/**
 * `npx tsx scripts/check-project-scope.ts` — browser regression check against
 * the live API. Needs Playwright's Chromium (as does build:poster).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import config from '../portal.config.ts';
import { shortNameOf } from '../src/config.ts';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
try {
  await server.listen();
  const site = server.resolvedUrls?.local[0];
  assert.ok(site);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    const details: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/v1\/hgab\/2027\/datasets\/[^/]+\/projects\//.test(request.url())) details.push(request.url());
    });

    // A Surigao del Sur record must be rejected even when opened directly.
    await page.goto(`${site}projects/dpwh/house-reading%3A4755`);
    await page.getByText(`This project is outside the scope of ${shortNameOf(config)}.`).waitFor();
    assert.equal(details.length, 0, 'Out-of-scope project details must not be fetched');

    await page.getByRole('link', { name: 'Back to every project' }).click();
    const project = page.locator('.project-title').first();
    await project.waitFor();
    assert.equal(await page.getByRole('link', { name: 'Offices and districts', exact: true }).count(), 0);
    assert.equal(await page.locator('.ocard').count(), 0);
    const title = await project.innerText();
    await project.click();
    await page.locator('.project-h').waitFor();
    assert.equal(await page.locator('.project-h').innerText(), title);
    assert.ok(details.length > 0, 'In-scope project details must still load');

    // Client-side navigation back to an out-of-scope record must also reject it.
    await page.getByRole('link', { name: '← Every project', exact: true }).click();
    const fetched = details.length;
    await page.evaluate(() => {
      history.pushState(null, '', '/projects/dpwh/house-reading%3A4755');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByText(`This project is outside the scope of ${shortNameOf(config)}.`).waitFor();
    assert.equal(details.length, fetched);
    assert.equal(await page.locator('.project-h').count(), 0);
    console.log('OK: city-only navigation; in-scope details load; out-of-scope details are blocked.');
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
