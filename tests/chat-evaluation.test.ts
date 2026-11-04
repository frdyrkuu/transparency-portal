/** Reviewed public questions only; two offline modes, no credentials or live generation. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handleChat } from '../api/chat.ts';
import type { ChatLog } from '../server/chat.ts';
import { loadSnapshot, retrieve, type RagResult } from '../server/rag.ts';
import type { ChatError, ChatRequest, ChatResponse, Fact, Stage } from '../src/api/chat-types.ts';

interface EvaluationCase {
  id: string;
  category: string;
  request: ChatRequest;
  expected: {
    status?: number;
    error?: string;
    mode?: ChatResponse['mode'];
    explanation?: boolean;
    records: string[] | 'all2027' | 'allGaa';
    evidence: string[];
    facts: Partial<Fact>[];
  };
  review: string;
}
const corpus = JSON.parse(await readFile(new URL('./chat-evaluation.json', import.meta.url), 'utf8')) as {
  reviewedAt: string; snapshotId: string; cases: EvaluationCase[];
};
const snapshot = await loadSnapshot();
const settings = { CHAT_ENABLED: 'true', GEMINI_MODEL: 'evaluation-only', GEMINI_API_KEY: 'EVALUATION_SECRET_CANARY' };
const post = (body: unknown) => new Request('https://portal.test/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const sorted = (keys: string[]) => [...keys].sort();

/** Independent raw-row arithmetic: deliberately do not call the production sum helpers. */
function checkFacts(response: ChatResponse) {
  for (const fact of response.facts) {
    const keys = fact.recordKey ? [fact.recordKey] : response.provenance.recordKeys;
    const projects = snapshot.projects.projects.filter((row) => keys.includes(row.key));
    const families = snapshot.gaa.rows.filter((row) => keys.includes(row.key));
    let value: number | null;
    let available: number;
    let missing: number;
    if (fact.stage === 'gaa') {
      assert.ok(families.length && !projects.length);
      const values = families.map((row) => row.years[String(fact.year)].amount);
      value = fact.kind === 'count' ? values.filter((amount) => amount > 0).length : values.reduce((sum, amount) => sum + amount, 0);
      available = families.length;
      missing = 0;
    } else {
      assert.ok(projects.length && !families.length);
      assert.equal(fact.year, 2027);
      if (fact.kind === 'difference') {
        assert.equal(fact.stage, 'house-minus-nep');
        const comparable = projects.every((row) => row.nep_php !== null && row.house_php !== null && !row.held && row.bridge_group !== 'scope_review');
        value = comparable ? projects.reduce((sum, row) => sum + row.house_php! - row.nep_php!, 0) : null;
        available = comparable ? projects.length : 0;
      } else {
        assert.ok(['nep', 'house', 'hgab2', 'hgab3', 'api'].includes(fact.stage));
        const stage = fact.stage as Exclude<Stage, 'gaa'>;
        const values = projects.map((row) => row[`${stage}_php`]).filter((amount) => amount !== null);
        available = values.length;
        value = fact.kind === 'count' ? available : available ? values.reduce((sum, amount) => sum + amount, 0) : null;
      }
      missing = projects.length - available;
    }
    assert.equal(fact.value, value, fact.id);
    assert.equal(fact.availableCount, available, fact.id);
    assert.equal(fact.missingCount, missing, fact.id);
    assert.equal(fact.unit, fact.kind === 'count' ? fact.stage === 'gaa' ? 'families' : 'records' : 'PHP');
    assert.ok(value === null || Number.isSafeInteger(value));
    assert.ok(fact.sourceIds.length && fact.sourceIds.every((id) => response.sources.some((source) => source.id === id
      && source.recordKey && keys.includes(source.recordKey))));
  }
}

test('evaluation corpus has the reviewed snapshot and all 30 required categories', () => {
  assert.equal(corpus.snapshotId, snapshot.manifest.snapshotId, 'Snapshot changed: review evidence and expectations before updating the evaluation snapshot ID.');
  assert.ok(Number.isFinite(Date.parse(corpus.reviewedAt)));
  assert.equal(new Set(corpus.cases.map((row) => row.id)).size, 30);
  const counts: Record<string, number> = {};
  for (const row of corpus.cases) {
    counts[row.category] = (counts[row.category] ?? 0) + 1;
    assert.ok(row.review.trim());
  }
  assert.deepEqual(counts, { definition: 6, lookup: 8, numeric: 6, ambiguous: 4, out_of_scope: 3, adversarial: 3 });
});

for (const row of corpus.cases) test(`${row.id} ${row.category}: ${row.request.message}`, async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Evaluation must not use the network'); });
  for (const enabled of [false, true]) await t.test(enabled ? 'synthetic provider' : 'reference-only', async () => {
    const expected = row.expected;
    let result: RagResult | undefined;
    let calls = 0;
    const logs: ChatLog[] = [];
    const response = await handleChat(post(row.request), {
      settings: { ...settings, CHAT_ENABLED: String(enabled) }, log: (event) => logs.push(event),
      lookup: async (request) => (result = await retrieve(request)),
      send: async (_url, init) => {
        calls++;
        assert.ok(String(init?.body).length <= 12_000);
        assert.ok(!String(init?.body).includes(settings.GEMINI_API_KEY));
        const input = JSON.parse(String(init?.body));
        const data = JSON.parse(input.contents[0].parts[0].text);
        assert.ok(data.evidence.length <= 6);
        const fact = data.facts[0];
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
          answer: row.request.language === 'en'
            ? 'This is a listed budget appropriation, not proof of actual spending or completion.'
            : 'Halagang nakalista sa budget ang nasa tala. Hindi ito patunay ng aktuwal na paggastos o pagkumpleto.',
          citationIds: [fact.sourceIds[0]], factIds: [fact.id],
        }) }] } }] });
      },
    });
    assert.equal(response.status, expected.status ?? 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as ChatResponse & ChatError;
    assert.doesNotMatch(JSON.stringify([body, logs]), /EVALUATION_SECRET_CANARY|attacker\.invalid|999999999/);
    assert.equal(calls, Number(enabled && !!expected.explanation));
    if (expected.error) {
      assert.equal(body.error.code, expected.error);
      assert.equal(result, undefined, 'Invalid evidence must be rejected before retrieval');
      return;
    }
    assert.ok(result);
    assert.equal(body.mode, enabled && expected.explanation ? 'ai' : expected.mode);
    assert.equal(body.aiUnavailable, !enabled && expected.explanation ? true : undefined);
    const recordKeys = expected.records === 'all2027' ? snapshot.projects.projects.map((p) => p.key)
      : expected.records === 'allGaa' ? snapshot.gaa.rows.map((p) => p.key) : expected.records;
    assert.deepEqual(sorted(body.provenance.recordKeys), sorted(recordKeys));
    assert.equal(body.provenance.matchedCount, recordKeys.length);
    assert.equal(body.snapshot.id, snapshot.manifest.snapshotId);
    assert.equal(body.provenance.snapshotId, body.snapshot.id);
    assert.ok(result.evidence.length <= 6);
    for (const id of expected.evidence) assert.ok(result.evidence.some((e) => e.key === id), `Missing expected evidence ${id}`);
    if (!expected.evidence.length) assert.deepEqual(result.evidence, []);
    if (!expected.facts.length) assert.deepEqual(body.facts, []);
    for (const fact of expected.facts) assert.ok(body.facts.some((actual: Fact) => Object.entries(fact).every(([key, value]) => actual[key as keyof Fact] === value)), `Missing expected fact ${JSON.stringify(fact)}`);
    checkFacts(body);
    if (typeof expected.records === 'string') assert.ok(recordKeys.length > 6, 'Aggregates must exercise the full-set/evidence-cap boundary');
    for (const source of body.sources) {
      const project = snapshot.projects.projects.find((p) => p.key === source.recordKey);
      const family = snapshot.gaa.rows.find((p) => p.key === source.recordKey);
      const urls = project ? [new URL(project.api_url, snapshot.manifest.apiBase).href, ...Object.values(project.pdf_url)]
        : family ? snapshot.gaa.queries.filter((q) => q.department_id === family.department_id).map((q) => q.api)
          : snapshot.glossary.flatMap((g) => g.sources);
      assert.ok(urls.includes(source.url), `Citation not in the source record: ${source.id}`);
      if (source.recordKey) assert.ok(recordKeys.includes(source.recordKey));
      if (project) {
        const stage = source.id.split(':').at(-1);
        const page = stage === 'nep' || stage === 'hgab2' || stage === 'hgab3' ? project[`${stage}_page`] : null;
        assert.equal(source.page, page ?? undefined, 'Project PDF page must match its source record');
      }
      if (family) assert.equal(source.page, undefined, 'Do not manufacture a GAA PDF page');
    }
    assert.ok(body.citationIds.every((id: string) => body.sources.some((s: { id: string }) => s.id === id)));
    assert.ok(body.factIds.every((id: string) => body.facts.some((f: Fact) => f.id === id)));
  });
});

test('missing bundled snapshot produces a private friendly 503 through the actual loader', () => {
  // Fresh process avoids the once-per-instance snapshot cache; mock only its file
  // read, without renaming or damaging the working snapshot used by other checks.
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.readFile;
    fs.readFile = (path, ...options) => String(path).endsWith('/data/rag/antipolo.json')
      ? Promise.reject(Object.assign(new Error('SNAPSHOT_PATH_CANARY'), { code: 'ENOENT' }))
      : original(path, ...options);
    syncBuiltinESMExports();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider'); };
    const logs = [];
    console.info = (entry) => logs.push(entry);
    const { default: chat } = await import('./api/chat.ts');
    const response = await chat.fetch(new Request('https://portal.test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Ano ang NEP?' })
    }));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.error.code, 'unavailable');
    assert.match(body.error.message, /maaari pa ring gamitin ang portal/);
    assert.equal(calls, 0);
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).category, 'evidence_unavailable');
    assert.doesNotMatch(JSON.stringify([body, logs]), /SNAPSHOT_PATH_CANARY|ENOENT/);
  `], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30_000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test('official title tokens are not inferred filters or completion claims; explicit requests still apply', async () => {
  const family = snapshot.gaa.rows[0]; // Its official title contains FMR.
  const completion = snapshot.projects.projects[0]; // Its title starts with Completion.
  for (const message of [`Ipaliwanag ${family.name}`, `Ipaliwanag ${family.key}`, `Ipaliwanag ${completion.title}`]) {
    const result = await retrieve({ message });
    assert.equal(result.mode, 'reference');
    assert.equal(result.needsExplanation, true);
    assert.equal(result.provenance.filter.program, null);
    assert.equal(result.provenance.filter.year, null);
    assert.ok(!result.evidence.some((e) => e.key === 'glossary:appropriation-not-spending'));
  }
  const limited = await retrieve({ message: `Tapos na ba ${completion.title}?` });
  assert.equal(limited.needsExplanation, false);
  assert.ok(limited.evidence.some((e) => e.key === 'glossary:appropriation-not-spending'));
  const filtered = await retrieve({ message: `Magkano GAA 2023 ${family.name}?`, filters: { program: 'DA' } });
  assert.equal(filtered.mode, 'reference');
  assert.deepEqual(filtered.provenance.recordKeys, [family.key]);
  assert.equal(filtered.provenance.filter.year, 2023);
  assert.equal(filtered.provenance.filter.program, 'da');
  for (const request of [
    { message: `Ipaliwanag ${family.name}`, filters: { program: 'FMR' } },
    { message: `Ipaliwanag ${family.name} 2027` },
  ]) assert.equal((await retrieve(request)).mode, 'no_data', 'Explicit incompatible filters must not be ignored');
});

test('snapshot freshness changes only after seven days and stale evidence remains usable', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Freshness check must stay offline'); });
  const collected = Date.parse(snapshot.manifest.collectedAt);
  const now = t.mock.method(Date, 'now');
  for (const age of [7 * 86400000, 7 * 86400000 + 1]) {
    now.mock.mockImplementation(() => collected + age);
    const response = await handleChat(post({ message: 'Ano ang NEP?' }), { settings: {}, log: () => {} });
    const body = await response.json() as ChatResponse;
    assert.equal(response.status, 200);
    assert.equal(body.snapshot.stale, age > 7 * 86400000);
    assert.equal(body.snapshot.id, snapshot.manifest.snapshotId);
    assert.ok(body.sources.length);
    assert.match(body.snapshot.notice, /hindi live/);
  }
});
