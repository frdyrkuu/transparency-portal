/** Offline browser checks: `npm run test:chat-ui`. Uses installed Playwright Chromium. */
import assert from 'node:assert/strict';
import { chromium, type Route } from 'playwright-core';
import { createServer } from 'vite';
import { loadSnapshot } from '../server/rag.ts';
import { answerChat } from '../server/chat.ts';
import type { ChatRequest, ChatResponse } from '../src/api/chat-types.ts';
import { date, phpFull } from '../src/lib/format.ts';

const snapshot = await loadSnapshot();
const meta = snapshot.manifest.sourceVersions.hgab;
const requests: ChatRequest[] = [];
const failures: string[] = [];
const reference = (request: ChatRequest) => answerChat(request, { settings: { CHAT_ENABLED: 'false' }, log: () => {} });
let respond: (route: Route, request: ChatRequest) => Promise<void> = async (route, request) => {
  await route.fulfill({ json: await reference(request) });
};
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
try {
  await server.listen();
  const site = server.resolvedUrls?.local[0];
  assert.ok(site);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    // Replay the bundled public snapshot for ordinary portal navigation, too. No live API/provider calls.
    await context.route('https://budget.bettergov.ph/**', async (route) => {
      const url = new URL(route.request().url());
      const dataset = url.pathname.match(/\/datasets\/([^/]+)\/projects(?:\/([^/]+))?$/);
      if (dataset) {
        const rows = snapshot.projects.projects.filter((p) => p.dataset === dataset[1]);
        if (dataset[2]) {
          const row = rows.find((p) => p.id === decodeURIComponent(dataset[2]!));
          assert.ok(row);
          await route.fulfill({ json: { meta, disclaimers: [], data: { ...row, labels: {
            status: { label: row.status_label, group: row.bridge_group, group_label: row.group_label, held: row.held },
            match: null, reading: null, dpwh_site: null, zone: null, flags: [],
          } } } });
        } else await route.fulfill({ json: { meta, disclaimers: [], data: { total: rows.length, rows } } });
      } else if (url.pathname === '/api/v1/hgab/2027') {
        await route.fulfill({ json: { meta, disclaimers: [], data: {
          record_versions: snapshot.reference.recordVersions,
          datasets: snapshot.reference.datasets.map((d) => ({ ...d, bridge: { groups: Object.fromEntries(d.groups.map((g) => [g.group, g])) } })),
        } } });
      } else await route.fulfill({ contentType: 'text/html', body: '<title>Budget source</title><h1>Budget source</h1>' });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(error.message));
    await page.route('**/api/chat', async (route) => {
      assert.equal(route.request().method(), 'POST');
      const request = route.request().postDataJSON() as ChatRequest;
      requests.push(request);
      assert.ok(Buffer.byteLength(route.request().postData()!, 'utf8') <= 8192);
      assert.ok(request.message.length <= 500);
      assert.ok((request.history?.length ?? 0) <= 2);
      for (const exchange of request.history ?? []) assert.ok(exchange.user.length <= 500 && exchange.assistant.length <= 500);
      await respond(route, request);
    });
    await page.goto(site);
    const opener = page.getByRole('button', { name: 'Magtanong tungkol sa budget', exact: true });
    const dialog = page.getByRole('dialog');
    const input = page.locator('#chat-question');
    await page.locator('.project-title').first().waitFor();
    assert.equal(await dialog.count(), 0, 'Chat must not open automatically');
    assert.equal(requests.length, 0);
    await opener.focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Isara', exact: true }).evaluate((el) => el === document.activeElement), true);
    assert.equal(await dialog.getAttribute('lang'), 'fil');
    assert.match(await dialog.locator('.chat-privacy').innerText(), /Google Gemini.*sensitibong/);
    assert.equal(await dialog.getByRole('link', { name: 'Mga tuntunin ng Google Gemini' }).getAttribute('href'), 'https://ai.google.dev/gemini-api/terms');
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab');
      // Chromium can focus browser chrome between Tab cycles; background page controls stay inert.
      assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body), true, 'Keyboard focus must not reach background controls');
    }
    await opener.evaluate((el) => el.focus());
    assert.equal(await opener.evaluate((el) => el === document.activeElement), false, 'Background controls must be inert');
    await dialog.getByRole('button', { name: 'Ano ang ibig sabihin ng NEP?', exact: true }).click();
    assert.equal(await input.inputValue(), 'Ano ang ibig sabihin ng NEP?');
    await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
    await dialog.getByRole('article', { name: 'Sagot mula sa mga tala', exact: true }).waitFor();
    assert.equal(requests[0].language, 'fil');
    assert.equal(requests[0].context, undefined);
    assert.equal(await dialog.getByRole('status').innerText(), 'Handa na ang sagot.');
    assert.ok((await dialog.locator('.chat-sources a').count()) > 0);
    assert.match(await dialog.locator('.chat-snapshot').innerText(), new RegExp(date(snapshot.manifest.collectedAt)));
    const popupPromise = context.waitForEvent('page');
    await dialog.locator('.chat-sources a').first().click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.ok(popup.url().startsWith('https://budget.bettergov.ph/'));
    await popup.close();

    await dialog.getByLabel('Wika / Language').selectOption('en');
    await dialog.getByRole('button', { name: 'What is NEP?', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByRole('article', { name: 'Reference answer', exact: true }).waitFor();
    assert.equal(requests.at(-1)!.language, 'en');
    assert.equal(requests.at(-1)!.history!.length, 1);
    assert.equal(await dialog.locator('.chat-conversation > li').first().getAttribute('lang'), 'fil');
    await dialog.getByRole('button', { name: 'Simpler explanation', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-conversation > li').length === 3);
    assert.equal(await dialog.locator('.chat-answer').last().getAttribute('aria-label'), 'Reference answer', 'Simplifying a glossary answer must retain its topic');
    await dialog.getByRole('button', { name: 'New conversation', exact: true }).click();
    assert.equal(await dialog.locator('.chat-conversation > li').count(), 0);
    assert.equal(await input.inputValue(), '');
    await page.keyboard.press('Escape');
    assert.equal(await opener.evaluate((el) => el === document.activeElement), true, 'Closing must return focus to opener');

    const projectLink = page.locator('.project-title').first();
    const href = (await projectLink.getAttribute('href'))!;
    const [, dataset, id] = href.match(/^\/projects\/([^/]+)\/(.+)$/)!;
    const projectKey = `${dataset}:${decodeURIComponent(id)}`;
    await projectLink.click();
    const explain = page.getByRole('button', { name: 'Ipaliwanag ang proyektong ito', exact: true });
    await explain.click();
    assert.equal(await input.inputValue(), 'Explain this project.');
    // AI output is synthetic; facts/sources are still built by the actual offline retriever.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let latest: ChatResponse;
    respond = async (route, request) => {
      latest = { ...await reference(request), mode: 'ai', aiUnavailable: undefined,
        answer: 'A source-supported explanation. <b>This stays plain text.</b> ' + 'detail '.repeat(90) };
      await gate;
      await route.fulfill({ json: latest });
    };
    const previousCount = requests.length;
    const send = dialog.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    await dialog.getByRole('status').getByText('Finding records and preparing the answer…').waitFor();
    assert.equal(await send.getAttribute('aria-disabled'), 'true');
    assert.equal(await input.getAttribute('readonly'), '');
    await dialog.locator('form').dispatchEvent('submit');
    assert.equal(requests.length, previousCount + 1, 'Duplicate in-flight submissions must be ignored');
    assert.deepEqual(requests.at(-1)!.context, { projectKey });
    assert.deepEqual(requests.at(-1)!.history, []);
    assert.deepEqual(Object.keys(requests.at(-1)!).sort(), ['context', 'history', 'language', 'message']);
    assert.equal(await dialog.getByLabel('Wika / Language').isDisabled(), true);
    release();
    await dialog.getByRole('article', { name: 'AI explanation', exact: true }).waitFor();
    assert.equal(await send.evaluate((el) => el === document.activeElement), true, 'Answer arrival must not move focus');
    assert.equal(await dialog.locator('.chat-prose b').count(), 0, 'Never render model HTML');
    assert.ok(await dialog.locator('.chat-prose').innerText().then((s) => s.includes('<b>')));
    for (const fact of latest!.facts.filter((f) => f.unit === 'PHP' && f.value !== null)) {
      assert.ok((await dialog.locator('.chat-facts').innerText()).includes(phpFull(fact.value)));
    }

    respond = async (route, request) => { await route.fulfill({ json: await reference(request) }); };
    for (let i = 0; i < 3; i++) {
      await dialog.getByRole('button', { name: 'Simpler explanation', exact: true }).click();
      await page.waitForFunction((count) => document.querySelectorAll('.chat-conversation > li').length === count, i + 2);
      assert.equal(requests.at(-1)!.context!.projectKey, projectKey);
      assert.equal(requests.at(-1)!.history!.length, Math.min(i + 1, 2));
    }
    assert.equal(requests[previousCount + 1].history![0].assistant.length, 500);
    assert.match(await dialog.locator('.chat-conversation > li').last().innerText(), /AI explanations are currently unavailable/);
    await dialog.getByRole('button', { name: 'New conversation', exact: true }).click();
    await dialog.getByLabel('Wika / Language').selectOption('fil');
    await input.fill('Magkano ang budget ng Antipolo?');
    await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
    await dialog.getByRole('article', { name: 'Kailangan ng paglilinaw', exact: true }).waitFor();
    assert.equal(requests.at(-1)!.context, undefined);
    assert.deepEqual(requests.at(-1)!.history, []);
    await input.fill('May kalsada sa Zzznomatch sa 2027?');
    await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
    await dialog.getByRole('article', { name: 'Walang sapat na tala', exact: true }).waitFor();

    // Stale data, zero and missing are visibly distinct, with partial totals called out.
    const figures = structuredClone(latest!);
    figures.mode = 'reference';
    figures.snapshot.stale = true;
    figures.facts = [
      { ...figures.facts[0], id: 'zero', label: 'Zero amount', value: 0, missingCount: 0 },
      { ...figures.facts[0], id: 'missing', label: 'Missing amount', value: null, missingCount: 1, availableCount: 0 },
      { ...figures.facts[0], id: 'partial', label: 'Partial amount', value: 1000, missingCount: 1 },
    ];
    respond = async (route) => { await route.fulfill({ json: figures }); };
    await input.fill('Mga halaga');
    await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
    await dialog.getByRole('article', { name: 'Sagot mula sa mga tala', exact: true }).waitFor();
    const last = dialog.locator('.chat-conversation > li').last();
    assert.match(await last.innerText(), /₱0/);
    assert.match(await last.innerText(), /Hindi nakalista/);
    assert.match(await last.innerText(), /Bahagyang kabuuan/);
    assert.match(await last.innerText(), /Lampas pitong araw/);

    for (const kind of ['quota', 'unavailable', 'html', 'malformed', 'unsafe-url', 'network'] as const) {
      respond = async (route) => {
        if (kind === 'network') await route.abort('failed');
        else if (kind === 'malformed') await route.fulfill({ json: { mode: 'ai' } });
        else if (kind === 'unsafe-url') await route.fulfill({ json: { ...figures, sources: [{ id: 'unsafe', title: 'Bad link', url: 'javascript:alert(1)' }] } });
        else await route.fulfill({ status: kind === 'quota' ? 429 : kind === 'unavailable' ? 503 : 200,
          contentType: 'text/html', body: '<h1>Technical WAF error with private details</h1>' });
      };
      await input.fill(`Tanong ${kind}`);
      await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), kind === 'quota' ? /Maghintay/ : kind === 'network' ? /koneksyon/ : /Hindi muna available/);
      assert.doesNotMatch(await dialog.innerText(), /Technical WAF error|private details/);
      assert.equal(await input.inputValue(), `Tanong ${kind}`);
      const requestCount: number = requests.length;
      await page.waitForTimeout(100);
      assert.equal(requests.length, requestCount, 'Errors must not automatically retry');
      if (kind === 'quota') {
        respond = async (route, request) => { await route.fulfill({ json: await reference(request) }); };
        await dialog.getByRole('button', { name: 'Subukang muli', exact: true }).click();
        await dialog.getByRole('status').getByText('Handa na ang sagot.', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('alert').count(), 0);
        assert.equal(requests.length, requestCount + 1, 'Edge recovery needs exactly one explicit retry');
        assert.equal(requests.at(-1)!.message, 'Tanong quota');
      }
    }
    respond = async (route, request) => { await route.fulfill({ json: await reference(request) }); };
    await dialog.getByRole('button', { name: 'Subukang muli', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
    assert.equal(requests.at(-1)!.message, 'Tanong network');

    // Clearing cancels a pending request and discards any late reply.
    let finish!: () => void;
    const delayed = new Promise<void>((resolve) => { finish = resolve; });
    respond = async (route) => { await delayed; await route.fulfill({ json: figures }); };
    await input.fill('Delayed reply');
    await dialog.getByRole('button', { name: 'Ipadala', exact: true }).click();
    await dialog.getByRole('status').getByText('Hinahanap ang mga tala at inihahanda ang sagot…').waitFor();
    await dialog.getByRole('button', { name: 'Bagong usapan', exact: true }).click();
    finish();
    await page.waitForTimeout(100);
    assert.equal(await dialog.locator('.chat-conversation > li').count(), 0);
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await explain.evaluate((el) => el === document.activeElement), true);
    await page.getByRole('link', { name: '← Every project', exact: true }).click();
    await page.locator('.project-title').first().waitFor();

    // Small-phone reflow and 200% text enlargement; every chat control remains reachable.
    await page.setViewportSize({ width: 320, height: 640 });
    await opener.click();
    for (const fontSize of [18, 36]) {
      await dialog.evaluate((el, size) => { el.style.fontSize = `${size}px`; }, fontSize);
      assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true, `No horizontal scroll at ${fontSize}px`);
      const box = (await dialog.boundingBox())!;
      assert.ok(box.x >= 0 && box.x + box.width <= 320);
      const controls = await dialog.locator('button, select, textarea').evaluateAll((elements) => elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
      assert.ok(controls.every((control) => control.width >= 44 && control.height >= 44));
    }
    await page.reload();
    await opener.click();
    assert.equal(await dialog.locator('.chat-conversation > li').count(), 0, 'Reload must clear memory-only history');
    assert.equal(await dialog.getAttribute('lang'), 'fil');
    assert.deepEqual(failures, [], 'No browser exceptions');
    console.log('OK: offline chat journey, project context, sources, language, bounded history, modes, errors/retry, focus, cancellation, mobile and 200% text.');
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
