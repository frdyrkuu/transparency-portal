/** Against a running `npx vercel dev`: `npx tsx scripts/check-vercel-dev.ts [http://localhost:3000]`. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const site = new URL(process.argv[2] ?? 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(site.hostname), 'Use a local development server');

for (const path of ['/', '/about', '/gaa', '/projects/dpwh/house-reading:4279', '/unknown-page']) {
  const response = await fetch(new URL(path, site), { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
  const html = await response.text();
  assert.ok(html.includes('/src/main.tsx') && !html.includes('%PORTAL_TITLE%'), `${path}: expected transformed portal HTML`);
}
for (const path of ['/src/main.tsx', '/portal.config.ts', '/@vite/client', '/@react-refresh', '/src/styles/app.css']) {
  const response = await fetch(new URL(path, site), { headers: { Accept: '*/*', 'Sec-Fetch-Dest': 'script' } });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type') ?? '', /(?:java|ecma)script/, path);
  assert.doesNotMatch(await response.text(), /<!doctype html/i, `${path}: HTML was served as a module`);
}
const missing = await fetch(new URL('/api/does-not-exist', site));
assert.equal(missing.status, 404);
const method = await fetch(new URL('/api/chat', site));
assert.equal(method.status, 405);
assert.equal(method.headers.get('allow'), 'POST');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(site.href);
  await page.getByRole('button', { name: 'Magtanong tungkol sa budget', exact: true }).click();
  await page.locator('#chat-question').fill('Ano ang pinagkaiba ng NEP at GAA?');
  // This reviewed glossary question never needs Gemini, even if local AI is enabled.
  const reply = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ipadala', exact: true }).click();
  const response = await reply;
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['cache-control'], 'no-store');
  const result = await response.json();
  assert.equal(result.mode, 'reference');
  assert.ok(result.sources.length > 0);
  const answer = page.getByRole('article', { name: 'Sagot mula sa mga tala', exact: true });
  await answer.waitFor();
  assert.match(await answer.innerText(), /National Expenditure Program/);
  assert.match(await answer.innerText(), /General Appropriations Act/);
  await page.getByRole('button', { name: 'Bagong usapan', exact: true }).click();
  await page.locator('#chat-question').fill('ano ang pinaka mataas na budget na lugar sa antipolo at ano ang proyektong ito?');
  await page.getByRole('button', { name: 'Ipadala', exact: true }).click();
  const clarification = page.getByRole('article', { name: 'Kailangan ng paglilinaw', exact: true });
  await clarification.waitFor();
  assert.match(await clarification.innerText(), /Walang kumpletong paghahati.*barangay/);
  assert.match(await clarification.innerText(), /Anong taon at bersiyon/);
  await page.locator('#chat-question').fill('Anong proyekto ang may pinakamataas na budget sa Antipolo 2027 House?');
  const rankingReply = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ipadala', exact: true }).click();
  const ranking = await (await rankingReply).json();
  assert.equal(ranking.mode, 'reference');
  assert.ok(ranking.facts.some((fact: { kind: string; value: number | null }) => fact.kind === 'amount' && fact.value !== null));
  await page.locator('.chat-conversation > li').last().getByRole('article', { name: 'Sagot mula sa mga tala', exact: true }).waitFor();
  for (const message of ['2027 projects sa antipolo kabuuhan', 'magkano budget ng antipolo?']) {
    await page.locator('#chat-question').fill(message);
    const liveReply = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/chat' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Ipadala', exact: true }).click();
    const summary = await (await liveReply).json();
    assert.equal(summary.mode, 'reference');
    assert.equal(summary.snapshot.live, true, 'Summary must use the actual Budget API');
    assert.ok(summary.sources.length > 0 && summary.sources.length <= 4);
    await page.locator('.chat-conversation > li').last().getByRole('article', { name: 'Sagot mula sa mga tala', exact: true }).waitFor();
    assert.doesNotMatch(await page.getByRole('dialog').textContent() ?? '', /sha256:|Bersyon ng datos/);
    if (message.includes('projects')) {
      await page.locator('.stats .stat').first().waitFor();
      const dashboardCount = Number((await page.locator('.stats .stat').first().innerText()).replaceAll(',', ''));
      assert.equal(summary.facts[0].value, dashboardCount, 'Chat count must agree with the dashboard');
    }
  }
  assert.deepEqual(errors, []);
  console.log('OK: real Vercel dev serves SPA pages/modules, API 404/405, sourced reference answers, and live API count/budget summaries matching the dashboard. No mocked chat or Gemini call.');
} finally {
  await browser.close();
}
