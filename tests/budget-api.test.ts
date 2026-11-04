import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat } from '../api/chat.ts';
import { retrieveWithApi } from '../server/budget-api.ts';
import { loadSnapshot, retrieve } from '../server/rag.ts';
import type { ChatResponse } from '../src/api/chat-types.ts';

const snapshot = await loadSnapshot();
function upstream(fault = '') {
  const calls: URL[] = [];
  const added = { ...snapshot.projects.projects.find((p) => p.dataset === 'dpwh')!, id: 'api-new', key: 'dpwh:api-new',
    title: 'New road project, Barangay Sta. Cruz, Antipolo City', nep_php: 123, house_php: 456, hgab3_php: 456, delta_php: 333,
    api_url: '/api/v1/hgab/2027/datasets/dpwh/projects/api-new' };
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, snapshot.manifest.apiBase);
    assert.equal(url.searchParams.get('q'), 'Antipolo City', 'Questions must not change the upstream city search');
    assert.ok(init?.signal && !init.signal.aborted);
    if (fault === 'timeout') throw new DOMException('Timeout', 'TimeoutError');
    if (fault === 'http') return new Response('UPSTREAM_ERROR_CANARY', { status: 500 });
    const dataset = /\/datasets\/(\w+)\/projects$/.exec(url.pathname)?.[1];
    assert.ok(dataset, 'Only allowlisted project-list endpoints may be fetched');
    const rows = structuredClone([
      ...snapshot.projects.projects.filter((p) => p.dataset === dataset),
      ...snapshot.projects.excluded.flatMap((e) => e.project?.dataset === dataset ? [e.project] : []),
      ...(dataset === 'dpwh' ? [added, { ...added, id: 'outside-region', region_key: 'VIII', nep_php: 999999, house_php: 999999 }] : []),
      ...(fault === 'paged' && dataset === 'dpwh' ? Array.from({ length: 210 }, (_, i) => ({ ...added, id: `paged-${i}` })) : []),
    ]);
    if (fault === 'duplicate' && rows.length) rows.push(rows[0]);
    if (fault === 'malformed' && rows.length) rows[0].nep_php = -1;
    if (fault === 'overflow') for (const row of rows) row.nep_php = Number.MAX_SAFE_INTEGER;
    const meta = { ...snapshot.manifest.sourceVersions.hgab,
      ...(fault === 'version' && dataset === 'fmr' ? { source_commit: 'changed-during-collection' } : {}) };
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return Response.json({ meta, disclaimers: [], data: { total: rows.length + Number(fault === 'incomplete'), rows: rows.slice(offset, offset + limit) } });
  };
  return { send, calls };
}

test('plain count and budget requests use current API data with dashboard scope and exclusions', async () => {
  for (const message of ['ilang project sa antipolo', '2027 projects sa antipolo kabuuhan', 'ilan budget sa antipolo', 'magkano budget ng antipolo?']) {
    const api = upstream();
    const result = await retrieveWithApi({ message }, api.send);
    assert.equal(result.mode, 'reference');
    assert.equal(api.calls.length, 4);
    assert.equal(result.snapshot.live, true);
    assert.equal(result.provenance.matchedCount, snapshot.projects.projects.length + 1);
    assert.ok(result.provenance.recordKeys.includes('dpwh:api-new'));
    assert.ok(!result.provenance.recordKeys.includes('dpwh:outside-region'));
    assert.ok(snapshot.manifest.scope.exclude.every((e) => !result.provenance.recordKeys.includes(e.key)));
    const count = result.facts.find((f) => f.stage === 'all');
    if (count) assert.equal(count.value, snapshot.projects.projects.length + 1);
    for (const stage of ['nep', 'house'] as const) {
      const amount = result.facts.find((f) => f.stage === stage && f.kind === 'amount');
      if (amount) assert.equal(amount.value, snapshot.projects.projects.reduce((sum, p) => sum + (p[`${stage}_php`] ?? 0), 0) + (stage === 'nep' ? 123 : 456));
    }
    assert.ok(result.sources.length <= 4);
    assert.equal(result.needsExplanation, false);
  }
});

test('live summary fetches every API page before counting', async () => {
  const api = upstream('paged');
  const result = await retrieveWithApi({ message: 'ilang project sa antipolo' }, api.send);
  assert.equal(result.snapshot.live, true);
  assert.equal(result.facts[0].value, snapshot.projects.projects.length + 211);
  assert.ok(api.calls.some((url) => url.searchParams.get('offset') === '200'));
});

test('natural summary requests and barangay spellings return current figures and structured project data', async () => {
  const api = upstream();
  const summary = await retrieveWithApi({ message: 'bigyan mo ako ng buod ng budget ng antipolo', context: { projectKey: snapshot.projects.projects[0].key } }, api.send);
  assert.equal(summary.mode, 'reference');
  assert.equal(summary.snapshot.live, true);
  assert.equal(summary.provenance.filter.projectKey, null, 'A city summary overrides an earlier selected project');
  assert.equal(summary.facts.find((fact) => fact.stage === 'all')?.value, snapshot.projects.projects.length + 1);
  assert.ok(summary.facts.some((fact) => fact.stage === 'nep' && fact.kind === 'amount'));
  assert.ok(summary.facts.some((fact) => fact.stage === 'house' && fact.kind === 'amount'));
  assert.doesNotMatch(summary.answer, /^Opo\.|wala akong nakitang|API|JSON/);
  for (const message of ['housebill barangay sta cruz', 'House bill Barangay Santa Cruz', 'house bill barangay Sta. Cruz 2027']) {
    const result = await retrieveWithApi({ message }, api.send);
    assert.equal(result.mode, 'reference', message);
    assert.equal(result.snapshot.live, true);
    const record = result.records.find((item) => item.key === 'dpwh:api-new');
    assert.ok(record, 'Show the newly fetched project, not just a source link');
    assert.match(record.title, /Sta\. Cruz/);
    assert.deepEqual(record.amounts, [{ year: 2027, stage: 'house', value: 456 }]);
  }
});

test('failed, incomplete, malformed and inconsistent API refreshes retain dated reference data', async () => {
  for (const fault of ['http', 'timeout', 'duplicate', 'incomplete', 'malformed', 'version', 'overflow']) {
    const request = { message: fault === 'overflow' ? 'magkano budget sa antipolo' : 'ilang project sa antipolo' };
    const reference = await retrieve(request);
    const api = upstream(fault);
    const result = await retrieveWithApi(request, api.send);
    assert.ok(api.calls.length > 0);
    assert.deepEqual(result.facts, reference.facts, fault);
    assert.equal(result.snapshot.live, undefined);
    assert.equal(result.snapshot.id, snapshot.manifest.snapshotId);
    assert.match(result.answer, /dati nang nakuhang datos/);
    assert.doesNotMatch(result.answer, /UPSTREAM_ERROR_CANARY/);
  }
});

test('definitions, other cities, forged context and unsupported years do not trigger API searches', async () => {
  const send: typeof fetch = async () => { assert.fail('Unexpected API request'); };
  for (const request of [
    { message: 'Ano ang NEP?' }, { message: 'Ilang proyekto sa Cebu City?' },
    { message: 'Magkano budget ng Antipolo City Hall?' }, { message: 'Ilang project 2035?' },
    { message: 'ilang project antipolo', context: { projectKey: 'dpwh:forged' } },
  ]) await retrieveWithApi(request, send);
});

test('the HTTP endpoint returns a live sourced count without calling Gemini', async (t) => {
  const api = upstream();
  t.mock.method(globalThis, 'fetch', api.send);
  const response = await handleChat(new Request('https://portal.test/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'ilang project sa antipolo' }),
  }), { settings: { CHAT_ENABLED: 'true', GEMINI_API_KEY: 'UNUSED', GEMINI_MODEL: 'unused' },
    send: async () => { assert.fail('A count must not need Gemini'); }, log: () => {} });
  assert.equal(response.status, 200);
  const body = await response.json() as ChatResponse;
  assert.equal(body.mode, 'reference');
  assert.equal(body.snapshot.live, true);
  assert.equal(body.facts[0].value, snapshot.projects.projects.length + 1);
});
