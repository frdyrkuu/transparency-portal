import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import config from '../portal.config.ts';
import { antipoloScope, buildSnapshot, collectSnapshot, validateSnapshot, type EvidenceSnapshot } from '../scripts/build-rag.ts';
import { loadSnapshot, normalize, retrieve, type RagResult } from '../server/rag.ts';
import { createClient, GAA_PAGE_SIZE, MAX_GAA_PROGRAMS, MAX_ROWS_PER_QUERY, PAGE_SIZE } from '../src/api/client.ts';
import { BRIDGE_GROUPS, GAA_YEARS, type Envelope, type GaaDepartment, type GaaEnvelope, type GaaProgram, type Meta, type Overview, type ProjectList, type ProjectRow } from '../src/api/types.ts';
import { DATASET_KEYS, type DatasetKey } from '../src/config.ts';
import { gaaYearTotals } from '../src/lib/gaa.ts';
import { summarise } from '../src/lib/scope.ts';

const fixtureConfig = { ...config, scope: { ...config.scope, exclude: [] } };

const meta: Meta = {
  dataset: 'hgab', fiscal_year: 2027, currency: 'PHP', scale: 'pesos',
  source_repo: 'https://github.com/example/public-data', source_commit: 'fixture-commit',
  built_at: '2026-10-26T08:46:14.383Z', notice: 'Fixture: amounts are not spending.',
};
const gaaMeta: GaaEnvelope<unknown>['meta'] = { dataset: 'gaa', years: [...GAA_YEARS], currency: 'PHP', scale: 'pesos' };
const years = (amount: number) => Object.fromEntries(GAA_YEARS.map((year) => [String(year), { amount: year === 2020 ? amount : 0, count: 2 }]));
const project = (id: string, overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id, dataset: 'dpwh', title: `Road ${id}, Antipolo City`, program: 'Roads', pap: null,
  region: 'Region IV-A', region_key: 'IV-A', office: null, office_kind: null, zone: null,
  trace: 'house_only', status_label: 'In the House bill only', bridge_group: 'house_only',
  group_label: 'Insertion candidates', held: true,
  nep_php: null, hgab2_php: 123456789, hgab3_php: 123456789, house_php: 123456789, api_php: null, delta_php: null,
  nep_page: null, hgab2_page: 2, hgab3_page: 2,
  pdf_url: { nep: null, hgab2: 'https://budget.test/house2.pdf#page=2', hgab3: 'https://budget.test/house3.pdf#page=2' },
  flags: ['unconfirmed'], lon: null, lat: null,
  url: `https://budget.test/projects/${id}`, api_url: `/api/v1/hgab/2027/datasets/dpwh/projects/${id}`,
  ...overrides,
});
const family = (id: string, amount = 987654321): GaaProgram => ({
  fam_key: `18-001|${id}`, department_id: '18', agency_id: '18-001',
  name: `${id}, Antipolo City`, ids_count: 1, years: years(amount),
});

/** Small fixture served through the real client's pagination and scope resolvers. */
function mockApi(t: TestContext) {
  const overview: Envelope<Overview> = {
    meta: { ...meta }, disclaimers: [], data: {
      title: 'Fixture budget', summary: 'Fixture', url: 'https://budget.test/overview',
      record_versions: (['nep', 'hgab2', 'hgab3', 'api'] as const).map((key) => ({ key, short: key, label: key, plain: key })),
      rules: ['Compare versions, never add them.'], terms: { nep: { term: 'NEP', meaning: 'Proposal' } },
      datasets: DATASET_KEYS.map((key) => ({
        key, label: key, short: key, agency: 'Fixture agency', summary: 'Fixture', one_row: 'One project',
        house_stage: key === 'dpwh' ? 'hgab3' : 'hgab2', house_stage_label: key === 'dpwh' ? 'Third reading' : 'Second reading',
        bridge: { groups: Object.fromEntries(BRIDGE_GROUPS.map((group) => [group, { group, label: group, sub: 'Provisional', help: 'Check the documents.', rows: 0, php: 0 }])) as Overview['datasets'][number]['bridge']['groups'] },
      })),
      documents: [{ key: 'house2', title: 'House bill', stage: 'house', reading: 2, volume: 'I-C', pdf_url: 'https://budget.test/house2.pdf', source_url: null }],
    },
  };
  const projects = Object.fromEntries(DATASET_KEYS.map((key): [DatasetKey, Envelope<ProjectList>] => [key, {
    meta: { ...meta },
    disclaimers: [{ id: 'notice', title: 'No allegations', body: 'Provisional only.', url: 'https://budget.test/methodology' }],
    data: { total: 0, rows: [], sums: { nep_php: null, hgab2_php: null, hgab3_php: null, unconfirmed_rows: 0, not_additive_across_versions: true } },
  }])) as Record<DatasetKey, Envelope<ProjectList>>;
  projects.dpwh.data.rows = [project('kept'), project('missing-region', { region: null, region_key: null, nep_php: 0, house_php: 0, hgab2_php: 0, hgab3_php: 0, delta_php: 0 }), project('outside', { region_key: 'VIII' }), project('excluded')];
  projects.dpwh.data.total = projects.dpwh.data.rows.length;
  const departments: GaaEnvelope<GaaDepartment[]> = {
    meta: { ...gaaMeta, total_items: 2 },
    data: ['18', '05'].map((id) => ({ id, slug: `department-${id}`, description: `Department ${id}`, years: years(1000000000) })),
  };
  const programs: Record<string, GaaEnvelope<GaaProgram[]>> = {
    '18': { meta: { ...gaaMeta, matched: 2 }, data: [family('kept'), family('excluded', 1000)], next_cursor: null },
    '05': { meta: { ...gaaMeta, matched: 0 }, data: [], next_cursor: null },
  };
  const calls: URL[] = [];
  let failedPath = '';
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin, 'https://budget.test', 'Tests must not call the network/provider');
    if (failedPath && url.pathname.includes(failedPath)) return new Response('Unavailable', { status: 503 });
    if (url.pathname === '/api/v1/hgab/2027') return Response.json(overview);
    if (url.pathname === '/api/v1/gaa/departments') return Response.json(departments);
    const dataset = /\/datasets\/(\w+)\/projects$/.exec(url.pathname)?.[1] as DatasetKey | undefined;
    if (dataset) {
      const response = projects[dataset];
      const offset = Number(url.searchParams.get('offset'));
      return Response.json({ ...response, data: { ...response.data, rows: response.data.rows.slice(offset, offset + PAGE_SIZE) } });
    }
    const departmentId = /\/gaa\/departments\/(\w+)\/programs$/.exec(url.pathname)?.[1];
    assert.ok(departmentId, `Unexpected fixture route: ${url.pathname}`);
    const response = programs[departmentId];
    const offset = Number(url.searchParams.get('cursor'));
    return Response.json({
      ...response, data: response.data.slice(offset, offset + GAA_PAGE_SIZE),
      next_cursor: response.next_cursor || (offset + GAA_PAGE_SIZE < response.data.length ? String(offset + GAA_PAGE_SIZE) : null),
    });
  });
  return { overview, projects, departments, programs, calls, fail: (path: string) => { failedPath = path; }, client: () => createClient('https://budget.test') };
}

test('snapshot preserves scope, exclusions, exact amounts, labels, sources and stable content ID', async (t) => {
  const api = mockApi(t);
  const portal = structuredClone(config);
  portal.scope.exclude = [{ key: 'dpwh:excluded', reason: 'Fixture namesake' }, { key: 'gaa:18-001|excluded', reason: 'Fixture exclusion' }];
  const directory = await mkdtemp(join(tmpdir(), 'rag-test-'));
  const output = join(directory, 'snapshot.json');
  try {
    await writeFile(output, 'previous snapshot\n');
    const snapshot = await buildSnapshot(api.client(), portal, output);
    const saved = JSON.parse(await readFile(output, 'utf8')) as EvidenceSnapshot;
    assert.deepEqual(saved.projects.projects.map((p) => p.id), ['kept', 'missing-region']);
    assert.deepEqual(saved.projects.projects[0], { ...api.projects.dpwh.data.rows[0], key: 'dpwh:kept', reasons: [{ kind: 'place', label: 'Antipolo City' }] });
    assert.equal(saved.projects.projects[0].nep_php, null);
    assert.equal(saved.projects.projects[1].nep_php, 0);
    assert.equal(saved.projects.projects[0].house_php, 123456789);
    assert.deepEqual(saved.projects.excluded[0].exclusion, portal.scope.exclude[0]);
    assert.equal(saved.projects.excluded[0].project?.id, 'excluded');
    assert.deepEqual(saved.gaa.excluded[0].exclusion, portal.scope.exclude[1]);
    assert.equal(saved.gaa.excluded[0].row?.fam_key, '18-001|excluded');
    assert.equal(saved.gaa.rows[0].years['2020'].amount, 987654321);
    assert.deepEqual(saved.gaa.rows[0].years['2021'], { count: 2, amount: 0 });
    assert.deepEqual(gaaYearTotals(saved.gaa.rows)[1], { year: 2021, programs: 0, amount: 0 });
    assert.deepEqual(summarise(saved.projects.projects), summarise(snapshot.projects.projects));
    assert.deepEqual(gaaYearTotals(saved.gaa.rows), gaaYearTotals(snapshot.gaa.rows));
    assert.equal(saved.manifest.counts.regionOmitted, 1);
    assert.equal(saved.manifest.queryCompleteness.queries.length, 6);
    assert.equal(saved.manifest.queryCompleteness.queries.filter((q) => q.kind === 'gaa' && q.matched === 0).length, 1);
    assert.equal(saved.manifest.sourceVersions.hgab.source_commit, meta.source_commit);
    assert.equal(saved.manifest.sourceVersions.gaa.built_at, null);
    assert.ok(saved.gaa.queries.every((q) => q.api.includes('q=Antipolo+City')));
    assert.deepEqual(saved.reference.recordVersions, api.overview.data.record_versions);
    assert.ok(saved.glossary.every((entry) => entry.sources.length && entry.fil && entry.en));
    assert.equal(saved.manifest.snapshotId, (await collectSnapshot(api.client(), portal)).manifest.snapshotId);
    api.projects.dpwh.data.rows[0].house_php = 123456790;
    const updated = await collectSnapshot(api.client(), portal);
    assert.equal(updated.manifest.scopeFingerprint, saved.manifest.scopeFingerprint);
    assert.notEqual(updated.manifest.snapshotId, saved.manifest.snapshotId);
    const changed = structuredClone(portal);
    changed.scope.exclude![0].reason = 'Updated reason';
    const revised = await collectSnapshot(api.client(), changed);
    assert.notEqual(revised.manifest.scopeFingerprint, saved.manifest.scopeFingerprint);
    assert.notEqual(revised.manifest.snapshotId, saved.manifest.snapshotId);
    assert.deepEqual(await readdir(directory), ['snapshot.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid scope is rejected before making any request', async (t) => {
  const api = mockApi(t);
  for (const patch of [
    { offices: ['Rizal office'] }, { districts: ['leg:rizal:1st'] },
    { places: [{ label: 'Antipolo City', region: 'VIII' }] },
    { places: [{ label: 'Antipolo City', q: 'Rizal', region: 'IV-A' }] },
    { places: [{ label: 'Antipolo City', region: 'IV-A', datasets: ['dpwh'] as DatasetKey[] }] },
    { places: [{ label: 'Antipolo City', region: 'IV-A' }, { label: 'Other City' }] },
  ]) {
    const portal = structuredClone(fixtureConfig);
    Object.assign(portal.scope, patch);
    await assert.rejects(collectSnapshot(api.client(), portal));
  }
  assert.equal(api.calls.length, 0);
  assert.deepEqual(antipoloScope(config).places[0].datasets, [...DATASET_KEYS]);
});

test('failed, truncated, duplicate or malformed collections cannot replace the last good file', async (t) => {
  const cases: [string, (api: ReturnType<typeof mockApi>) => void][] = [
    ['required request fails', (api) => api.fail('/departments/05/programs')],
    ['truncated project query', (api) => { api.projects.dpwh.data.total = MAX_ROWS_PER_QUERY + 1; }],
    ['missing project page', (api) => { api.projects.dpwh.data.total++; }],
    ['duplicate project', (api) => { api.projects.dpwh.data.rows[1].id = 'kept'; }],
    ['conflicting project', (api) => { api.projects.dpwh.data.rows[1] = project('kept', { house_php: 1 }); }],
    ['malformed project amount', (api) => { api.projects.dpwh.data.rows[0].nep_php = 1.5; }],
    ['unsafe project amount', (api) => { api.projects.dpwh.data.rows[0].nep_php = Number.MAX_SAFE_INTEGER + 1; }],
    ['missing project amount', (api) => { delete (api.projects.dpwh.data.rows[0] as Partial<ProjectRow>).house_php; }],
    ['wrong dataset', (api) => { api.projects.dpwh.data.rows[0].dataset = 'nia'; }],
    ['unsafe citation', (api) => { api.projects.dpwh.data.rows[0].pdf_url.hgab2 = 'javascript:alert(1)'; }],
    ['source version changed', (api) => { api.projects.dpwh.meta.source_commit = 'different'; }],
    ['missing GAA family', (api) => { api.programs['18'].meta.matched = 3; }],
    ['duplicate GAA family', (api) => { api.programs['18'].data[1] = family('kept'); }],
    ['conflicting GAA family', (api) => { api.programs['18'].data[1] = family('kept', 1); }],
    ['conflicting family across departments', (api) => {
      api.programs['05'].data = [{ ...family('kept'), department_id: '05', agency_id: '05-001' }];
      api.programs['05'].meta.matched = 1;
    }],
    ['wrong GAA department', (api) => { api.programs['18'].data[0].department_id = '05'; }],
    ['missing GAA year', (api) => { delete api.programs['18'].data[0].years['2021']; }],
    ['negative GAA amount', (api) => { api.programs['18'].data[0].years['2021'].amount = -1; }],
    ['missing department', (api) => { api.departments.meta.total_items = 3; }],
    ['duplicate department', (api) => { api.departments.data[1].id = '18'; }],
    ['stalled cursor', (api) => { api.programs['18'].next_cursor = '0'; }],
    ['empty cursor page', (api) => { api.programs['05'].next_cursor = '0'; }],
    ['truncated GAA query', (api) => {
      api.programs['18'].data = Array.from({ length: MAX_GAA_PROGRAMS + 1 }, (_, i) => family(String(i)));
      api.programs['18'].meta.matched = MAX_GAA_PROGRAMS + 1;
    }],
  ];
  for (const [name, corrupt] of cases) await t.test(name, async (t) => {
    const api = mockApi(t);
    corrupt(api);
    const directory = await mkdtemp(join(tmpdir(), 'rag-failure-'));
    const output = join(directory, 'snapshot.json');
    try {
      await writeFile(output, 'last good snapshot\n');
      await assert.rejects(buildSnapshot(api.client(), fixtureConfig, output));
      assert.equal(await readFile(output, 'utf8'), 'last good snapshot\n');
      assert.deepEqual(await readdir(directory), ['snapshot.json']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test('complete multi-page project and GAA collections retain every record', async (t) => {
  const api = mockApi(t);
  api.projects.dpwh.data.rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => project(String(i)));
  api.projects.dpwh.data.total = PAGE_SIZE + 1;
  api.programs['18'].data = Array.from({ length: GAA_PAGE_SIZE + 1 }, (_, i) => family(String(i)));
  api.programs['18'].meta.matched = GAA_PAGE_SIZE + 1;
  const snapshot = await collectSnapshot(api.client(), fixtureConfig);
  assert.equal(snapshot.projects.projects.length, PAGE_SIZE + 1);
  assert.equal(snapshot.gaa.rows.length, GAA_PAGE_SIZE + 1);
  assert.ok(api.calls.some((url) => url.searchParams.get('offset') === String(PAGE_SIZE)));
  assert.ok(api.calls.some((url) => url.searchParams.get('cursor') === String(GAA_PAGE_SIZE)));
});

test('bundled public snapshot is complete, scoped and traceable without network access', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Offline check must not fetch'); });
  const snapshot = JSON.parse(await readFile(new URL('../data/rag/antipolo.json', import.meta.url), 'utf8')) as EvidenceSnapshot;
  assert.equal(snapshot.manifest.schemaVersion, 1);
  assert.match(snapshot.manifest.snapshotId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.manifest.scope, antipoloScope(config));
  assert.equal(snapshot.manifest.counts.projects, snapshot.projects.projects.length);
  assert.equal(snapshot.manifest.counts.gaaFamilies, snapshot.gaa.rows.length);
  assert.equal(snapshot.manifest.counts.glossary, snapshot.glossary.length);
  assert.deepEqual(snapshot.projects.excluded.map((entry) => entry.exclusion), config.scope.exclude?.filter((entry) => !entry.key.startsWith('gaa:')) ?? []);
  assert.ok(snapshot.projects.excluded.every((entry) => entry.project));
  assert.equal(snapshot.manifest.queryCompleteness.complete, true);
  const queries = snapshot.manifest.queryCompleteness.queries;
  assert.equal(queries.length, DATASET_KEYS.length + snapshot.gaa.departments.length);
  assert.ok(queries.every((q) => q.complete && q.fetched === q.matched));
  assert.equal(new Set(queries.map((q) => q.api)).size, queries.length);
  const ids = [...snapshot.projects.projects, ...snapshot.gaa.rows].map((row) => row.key);
  assert.equal(new Set(ids).size, ids.length);
  for (const project of snapshot.projects.projects) {
    assert.ok(project.region_key === null || project.region_key === 'IV-A');
    assert.deepEqual(project.reasons, [{ kind: 'place', label: 'Antipolo City' }]);
    assert.ok(!snapshot.manifest.scope.exclude.some((excluded) => excluded.key === project.key));
  }
  for (const row of snapshot.gaa.rows) {
    assert.ok(snapshot.gaa.queries.some((query) => query.department_id === row.department_id && row.reasons.includes(query.place)));
  }
  const glossary = JSON.parse(await readFile(new URL('../data/rag/glossary.json', import.meta.url), 'utf8'));
  assert.deepEqual(snapshot.glossary, glossary, 'Refresh the snapshot after changing the reviewed glossary');
});

async function retrievalFixture(t: TestContext, edit?: (api: ReturnType<typeof mockApi>) => void) {
  const api = mockApi(t);
  for (const d of api.overview.data.datasets) {
    d.label = `${d.key.toUpperCase()} projects`;
    d.short = d.key.toUpperCase();
    d.agency = d.key === 'dpwh' ? 'Department of Public Works and Highways' : `Agency ${d.key}`;
  }
  api.departments.data[0].description = 'Department of Public Works and Highways (DPWH)';
  api.projects.dpwh.data.rows = [
    ...Array.from({ length: 8 }, (_, i) => project(`road-${i}`, {
      title: `Road Improvement Section ${i}, Mayamot, Antipolo City`,
      nep_php: i === 0 ? null : i === 1 ? 0 : 100 + i,
      house_php: 200 + i, hgab2_php: 150 + i, hgab3_php: 200 + i,
      held: false, bridge_group: 'increased', status_label: 'Higher amount', flags: [],
    })),
    project('bridge', { title: 'Bridge at Calawis, Antipolo City', program: 'Bridges', nep_php: 100, house_php: 300, hgab3_php: 300, held: false, bridge_group: 'increased' }),
    project('missing', { title: 'Missing Amount, Antipolo City', program: null, nep_php: null, house_php: null, hgab2_php: null, hgab3_php: null }),
    ...config.scope.exclude!.map((e) => project(e.key.slice('dpwh:'.length))),
  ];
  api.projects.dpwh.data.total = api.projects.dpwh.data.rows.length;
  api.projects.hfep.data.rows = [project('hospital', { dataset: 'hfep', title: 'Hospital at San Jose, Antipolo City', program: 'Health Facilities' })];
  api.projects.hfep.data.total = 1;
  api.programs['18'].data = [family('Road Legacy Mayamot', 900), family('Bridge Legacy Calawis', 500)];
  edit?.(api);
  return collectSnapshot(api.client());
}

const amount = (result: RagResult, stage: string, year = 2027) => result.facts.find((f) => f.kind === 'amount' && f.stage === stage && f.year === year);

test('bundled retriever loads once, works offline, and rejects schema/scope/content damage', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Retrieval must be offline'); });
  const [first, second] = await Promise.all([loadSnapshot(), loadSnapshot()]);
  assert.equal(first, second);
  validateSnapshot(first);
  const key = first.projects.projects[0].key;
  const result = await retrieve({ message: 'Ipaliwanag ang proyektong ito.', context: { projectKey: key } });
  assert.equal(result.mode, 'reference');
  assert.equal(result.needsExplanation, true);
  assert.deepEqual(result.provenance.recordKeys, [key]);
  assert.ok(result.sources.every((s) => s.url.startsWith('https://')));
  assert.ok(result.evidence.length <= 6);
  const total = await retrieve({ message: 'Total NEP FY2027' });
  assert.equal(total.provenance.matchedCount, first.projects.projects.length);
  assert.equal(amount(total, 'nep')?.value, summarise(first.projects.projects).nep.php);
  const enacted = await retrieve({ message: 'Total GAA 2020' });
  assert.equal(enacted.provenance.matchedCount, first.gaa.rows.length);
  assert.equal(amount(enacted, 'gaa', 2020)?.value, gaaYearTotals(first.gaa.rows)[0].amount);
  for (const corrupt of [
    (s: EvidenceSnapshot) => { s.manifest.schemaVersion = 2; },
    (s: EvidenceSnapshot) => { s.manifest.scope.places[0].region = 'VIII'; },
    (s: EvidenceSnapshot) => { s.manifest.scopeFingerprint = 'forged'; },
    (s: EvidenceSnapshot) => { s.manifest.queryCompleteness.complete = false as true; },
    (s: EvidenceSnapshot) => { s.projects.projects[0].house_php = -1; },
    (s: EvidenceSnapshot) => { s.projects.projects[0].title += ' edited'; },
    (s: EvidenceSnapshot) => { s.projects.projects[0].api_url = 'javascript:alert(1)'; },
  ]) {
    const broken = structuredClone(first);
    corrupt(broken);
    await assert.rejects(retrieve({ message: 'NEP' }, broken));
  }
});

test('exact IDs, title phrases, context membership and explicit context overrides', async (t) => {
  const data = await retrievalFixture(t);
  const context = { projectKey: 'dpwh:road-0' };
  for (const message of ['dpwh:bridge', 'Bridge at Calawis, Antipolo City', 'bridge']) {
    const result = await retrieve({ message, context }, data);
    assert.equal(result.mode, 'reference', message);
    assert.deepEqual(result.provenance.recordKeys, ['dpwh:bridge']);
    assert.equal(amount(result, 'nep')?.value, 100);
    assert.equal(amount(result, 'house')?.value, 300);
    assert.equal(result.facts.find((f) => f.kind === 'difference')?.value, 200);
  }
  const followup = await retrieve({ message: 'Magkano sa NEP?', context }, data);
  assert.equal(amount(followup, 'nep')?.value, null);
  const explanation = await retrieve({ message: 'Ipaliwanag ang proyektong ito.', context }, data);
  assert.equal(explanation.needsExplanation, true);
  for (const projectKey of ['dpwh:forged', config.scope.exclude![0].key, 'gaa:not-a-family']) {
    const result = await retrieve({ message: 'Ano ang NEP?', context: { projectKey } }, data);
    assert.equal(result.mode, 'no_data');
    assert.equal(result.sources.length, 0);
  }
  const forged = await retrieve({ message: 'dpwh:bridge dpwh:forged' }, data);
  assert.equal(forged.mode, 'no_data');
  const obsolete = await retrieve({ message: 'dpwh:road-01' }, data);
  assert.equal(obsolete.mode, 'no_data');
  const missing = await retrieve({ message: 'A completely unknown project in Mayamot' }, data);
  assert.equal(missing.mode, 'no_data');
});

test('normalized Filipino, English and Taglish searches apply years and programs first', async (t) => {
  const data = await retrievalFixture(t);
  assert.equal(normalize('  KÁLSADA—Mayamot!!  '), 'kalsada mayamot');
  for (const message of ['May nakalistang proyekto para sa kalsada sa Mayamot 2027?', 'List ROADS, Mayamot — FY2027!', 'Show daan sa Mayamot 2027']) {
    const result = await retrieve({ message }, data);
    assert.equal(result.mode, 'reference', message);
    assert.equal(result.provenance.matchedCount, 8);
    assert.ok(result.evidence.length <= 6);
    assert.ok(result.provenance.recordKeys.every((key) => key.startsWith('dpwh:road-')));
  }
  for (const [message, key] of [['Ipaliwanag ang tulay sa Calawis 2027', 'dpwh:bridge'], ['Ipaliwanag ang ospital sa San Jose 2027', 'hfep:hospital']]) {
    const result = await retrieve({ message }, data);
    assert.equal(result.mode, 'reference', message);
    assert.deepEqual(result.provenance.recordKeys, [key]);
  }
  const program = await retrieve({ message: 'List kalsada Mayamot', filters: { year: 2027, program: 'DPWH' } }, data);
  assert.equal(program.provenance.matchedCount, 8);
  const gaa = await retrieve({ message: 'List kalsada Mayamot 2020 DPWH' }, data);
  assert.equal(gaa.mode, 'reference');
  assert.equal(amount(gaa, 'gaa', 2020)?.value, 900);
  assert.equal(gaa.provenance.matchedCount, 1);
  const wrongProgram = await retrieve({ message: 'List kalsada Mayamot', filters: { year: 2027, program: 'HFEP' } }, data);
  assert.equal(wrongProgram.mode, 'no_data');
});

test('ambiguous names, years, versions and program filters clarify without guessing', async (t) => {
  const data = await retrievalFixture(t);
  for (const request of [
    { message: 'Ipaliwanag ang kalsada Mayamot 2027' },
    { message: 'Magkano ang budget ng Antipolo?' },
    { message: 'Magkano ang dpwh:bridge?' },
    { message: 'Total GAA roads Mayamot' },
    { message: 'List road Mayamot' },
    { message: 'Total road Mayamot 2020 2021' },
    { message: 'Total NEP road Mayamot 2020' },
    { message: 'List road Mayamot 2027', filters: { year: 2026 } },
    { message: 'List road Mayamot 2027', filters: { program: 'invented' } },
    { message: 'List road Mayamot 2027 NEP', filters: { stage: 'house' as const } },
    { message: 'List road Mayamot 2027 HFEP', filters: { program: 'DPWH' } },
    { message: 'List road Mayamot 2027 DPWH HFEP' },
    { message: 'Bridge at Calawis, Antipolo City', filters: { projectKey: 'dpwh:road-0' } },
  ]) {
    const result = await retrieve(request, data);
    assert.equal(result.mode, 'clarification', JSON.stringify(request));
    assert.equal(result.needsExplanation, false);
    assert.equal(result.facts.length, 0);
    assert.ok(result.evidence.length <= 6);
  }
  const unknownYear = await retrieve({ message: 'Total NEP road Mayamot 2030' }, data);
  assert.equal(unknownYear.mode, 'no_data');
});

test('full-set aggregates exceed six records, preserve missing versus zero, and never add versions', async (t) => {
  const data = await retrievalFixture(t);
  const result = await retrieve({ message: 'Compare total NEP at House kalsada Mayamot 2027' }, data);
  assert.equal(result.mode, 'reference');
  assert.equal(result.provenance.matchedCount, 8);
  assert.equal(result.evidence.length, 6);
  assert.equal(amount(result, 'nep')?.value, 627);
  assert.equal(amount(result, 'nep')?.availableCount, 7);
  assert.equal(amount(result, 'nep')?.missingCount, 1);
  assert.equal(amount(result, 'house')?.value, 1628);
  assert.equal(result.facts.find((f) => f.kind === 'difference')?.value, null, 'Do not compare unequal/uncertain coverage');
  assert.ok(!result.facts.some((f) => f.value === 2255), 'Never sum NEP and House');
  assert.ok(result.provenance.recordKeys.includes('dpwh:road-7'), 'The complete set remains traceable');
  assert.ok(result.sources.some((s) => s.recordKey === 'dpwh:road-7'));
  const same = await retrieve({ message: 'Compare total NEP at House kalsada Mayamot 2027' }, data);
  assert.deepEqual(same.facts.map((f) => f.id), result.facts.map((f) => f.id));
  const filipino = await retrieve({ message: 'Kabuuang halaga ng mga kalsada sa Mayamot', filters: { year: 2027, stage: 'nep', program: 'dpwh' } }, data);
  assert.equal(filipino.mode, 'reference');
  assert.equal(amount(filipino, 'nep')?.value, 627);
  assert.equal(filipino.provenance.matchedCount, 8);
  for (const key of ['dpwh:road-0', 'dpwh:road-1', 'dpwh:missing']) {
    const response = await retrieve({ message: 'Magkano NEP?', context: { projectKey: key } }, data);
    assert.equal(amount(response, 'nep')?.value, key === 'dpwh:road-1' ? 0 : null);
  }
  const reading = await retrieve({ message: 'Magkano second reading?', context: { projectKey: 'dpwh:road-2' } }, data);
  assert.equal(amount(reading, 'hgab2')?.value, 152);
  const missing = await retrieve({ message: 'Total NEP', filters: { projectKey: 'dpwh:missing' } }, data);
  assert.equal(amount(missing, 'nep')?.value, null, 'An entirely missing aggregate is not zero');
  for (const fact of result.facts) {
    assert.ok(result.allowedFactIds.includes(fact.id));
    assert.ok(fact.sourceIds.every((id) => result.allowedSourceIds.includes(id) && result.sources.some((s) => s.id === id)));
  }
});

test('GAA zero-year carry-forwards are not funded; years and sources remain separate', async (t) => {
  const data = await retrievalFixture(t);
  const key = data.gaa.rows.find((r) => r.name.startsWith('Road Legacy'))!.key;
  const result = await retrieve({ message: 'Ipaliwanag ang proyektong ito.', context: { projectKey: key } }, data);
  assert.equal(result.mode, 'reference');
  assert.equal(amount(result, 'gaa', 2020)?.value, 900);
  assert.equal(amount(result, 'gaa', 2021)?.value, 0);
  assert.equal(result.facts.find((f) => f.kind === 'count' && f.year === 2021)?.value, 0);
  assert.equal(result.facts.filter((f) => f.kind === 'amount').length, 7);
  assert.ok(result.sources.every((s) => s.url.includes('/gaa/departments/18/programs') && !s.page));
  const aggregate = await retrieve({ message: 'Total GAA kalsada Mayamot 2021' }, data);
  assert.equal(amount(aggregate, 'gaa', 2021)?.value, 0);
  assert.equal(aggregate.facts.find((f) => f.kind === 'count')?.value, 0);
});

test('unsafe aggregate arithmetic is rejected instead of rounding peso totals', async (t) => {
  const data = await retrievalFixture(t, (api) => {
    for (const p of api.projects.dpwh.data.rows) p.nep_php = Number.MAX_SAFE_INTEGER;
  });
  await assert.rejects(retrieve({ message: 'Total NEP kalsada Mayamot 2027' }, data), /Unsafe financial total/);
});

test('reviewed bilingual definitions, limitations and scope answers never need generation', async (t) => {
  const data = await retrievalFixture(t);
  for (const message of ['Ano ang ibig sabihin ng NEP?', 'What is GAA?', 'Ano ang pinagkaiba ng panukalang budget at batas na budget?', 'Ano ang unconfirmed match?']) {
    for (const language of ['fil', 'en'] as const) {
      const result = await retrieve({ message, language }, data);
      assert.equal(result.mode, 'reference', message);
      assert.equal(result.needsExplanation, false);
      assert.ok(result.evidence.length > 0);
      assert.ok(result.evidence.every((e) => e.kind === 'glossary'));
      for (const e of result.evidence) if (e.kind === 'glossary') assert.ok(result.answer.includes(e.record[language]));
    }
  }
  for (const message of ['Magkano ang budget ng Cebu City?', 'List roads sa Manila', 'Budget ng lungsod ng Davao']) {
    const result = await retrieve({ message }, data);
    assert.equal(result.mode, 'reference');
    assert.equal(result.evidence[0]?.key, 'glossary:antipolo-coverage');
    assert.equal(result.provenance.matchedCount, 0);
  }
  const completion = await retrieve({ message: 'Tapos na ba ito?', context: { projectKey: 'dpwh:road-0' } }, data);
  assert.equal(completion.needsExplanation, false);
  assert.match(completion.answer, /Hindi ipinapakita ng tala kung tapos/);
  assert.ok(completion.evidence.some((e) => e.key === 'glossary:appropriation-not-spending'));
  assert.ok(completion.evidence.length <= 6);
  const spending = await retrieve({ message: 'Magkano ang ginastos?', context: { projectKey: 'dpwh:road-0' } }, data);
  assert.equal(spending.mode, 'reference');
  assert.equal(spending.needsExplanation, false);
  assert.match(spending.answer, /hindi awtomatikong halagang nagastos/);
  const provisional = await retrieve({ message: 'Ipaliwanag ang proyektong ito.', context: { projectKey: 'hfep:hospital' } }, data);
  assert.ok(provisional.evidence.some((e) => e.key === 'glossary:comparison-candidates'));
  assert.match(provisional.answer, /hindi kumpirmadong/);
  assert.equal(provisional.facts.find((f) => f.kind === 'difference')?.value, null);
  const broad = await retrieve({ message: 'pondo' }, data);
  assert.ok(broad.evidence.every((e) => e.kind === 'glossary'));
  t.mock.method(Date, 'now', () => Date.parse(data.manifest.collectedAt) + 8 * 86400000);
  const stale = await retrieve({ message: 'NEP' }, data);
  assert.equal(stale.snapshot.stale, true);
  assert.equal(stale.snapshot.id, data.manifest.snapshotId);
  assert.match(stale.snapshot.notice, /hindi live/);
});
