/** Collect public evidence only. Gemini configuration is neither read nor needed. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import config from '../portal.config.ts';
import { createClient, type Client } from '../src/api/client.ts';
import { BRIDGE_GROUPS, GAA_YEARS, type GaaEnvelope, type GaaYears, type Meta, type ProjectRow } from '../src/api/types.ts';
import { configProblems, DATASET_KEYS, DEFAULT_API, type PortalConfig } from '../src/config.ts';
import { gaaYearTotals, resolveGaa } from '../src/lib/gaa.ts';
import { resolveScope, summarise } from '../src/lib/scope.ts';

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  fil: string;
  en: string;
  sources: string[];
  reviewedAt: string;
}

const outputPath = fileURLToPath(new URL('../data/rag/antipolo.json', import.meta.url));
const glossaryPath = new URL('../data/rag/glossary.json', import.meta.url);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown, signed = false) => Number.isSafeInteger(value) && (signed || Number(value) >= 0);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');

function unique(values: string[], label: string) {
  assert.ok(values.every(text) && new Set(values).size === values.length, `Missing or duplicate ${label}`);
}

function sourceUrl(value: unknown, base?: string) {
  assert.ok(text(value), 'Missing source URL');
  const url = new URL(value, base);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Source URL must be public HTTPS');
}

/** Exact declared city scope; exclusions may narrow it without changing the search. */
export function antipoloScope(portal: PortalConfig) {
  assert.deepEqual(configProblems(portal), [], 'Invalid portal configuration');
  assert.equal(portal.id, 'antipolo-city', 'RAG is restricted to antipolo-city');
  assert.equal(portal.kind, 'city');
  assert.equal(portal.scope.offices?.length ?? 0, 0, 'Whole-office queries are outside the Antipolo scope');
  assert.equal(portal.scope.districts?.length ?? 0, 0, 'Districts are outside the Antipolo scope');
  assert.equal(portal.scope.places?.length, 1, 'Exactly one Antipolo place is required');
  const place = portal.scope.places[0];
  assert.equal(place.label, 'Antipolo City');
  assert.equal(place.q ?? place.label, 'Antipolo City', 'Antipolo query changed');
  assert.equal(place.region, 'IV-A', 'Antipolo region changed');
  assert.deepEqual([...(place.datasets ?? DATASET_KEYS)].sort(), [...DATASET_KEYS].sort(), 'All four programs are required');
  const exclude = [...(portal.scope.exclude ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  unique(exclude.map((e) => e.key), 'exclusion IDs');
  return { offices: [], districts: [], places: [{ label: place.label, q: place.q ?? place.label, region: place.region, datasets: [...DATASET_KEYS] }], exclude };
}

export function validateProject(row: ProjectRow, dataset: string, base: string) {
  assert.ok(row && text(row.id) && text(row.title), 'Malformed project ID/title');
  assert.equal(row.dataset, dataset, 'Project returned in the wrong dataset');
  for (const field of ['program', 'pap', 'region', 'region_key', 'office', 'office_kind', 'zone'] as const) {
    assert.ok(row[field] === null || text(row[field]), `Invalid project ${field}`);
  }
  for (const field of ['nep_php', 'hgab2_php', 'hgab3_php', 'house_php', 'api_php', 'delta_php'] as const) {
    assert.ok(row[field] === null || integer(row[field], field === 'delta_php'), `Invalid project ${field}`);
  }
  for (const field of ['nep_page', 'hgab2_page', 'hgab3_page'] as const) {
    assert.ok(row[field] === null || (integer(row[field]) && Number(row[field]) > 0), `Invalid project ${field}`);
  }
  assert.ok(BRIDGE_GROUPS.includes(row.bridge_group), 'Invalid comparison group');
  assert.ok(text(row.status_label) && text(row.group_label) && text(row.trace), 'Missing published project labels');
  assert.equal(typeof row.held, 'boolean', 'Missing unconfirmed-match flag');
  assert.ok(Array.isArray(row.flags) && row.flags.every(text), 'Invalid project flags');
  assert.ok(row.pdf_url && typeof row.pdf_url === 'object' && !Array.isArray(row.pdf_url), 'Invalid PDF references');
  for (const url of Object.values(row.pdf_url)) if (url !== null) sourceUrl(url);
  sourceUrl(row.url);
  sourceUrl(row.api_url, base);
}

function validateYears(years: GaaYears) {
  assert.ok(years && typeof years === 'object', 'Missing GAA year amounts');
  assert.deepEqual(Object.keys(years).sort(), GAA_YEARS.map(String).sort(), 'Unexpected or missing GAA years');
  for (const value of Object.values(years)) {
    assert.ok(value && integer(value.amount) && integer(value.count), 'Invalid GAA amount/count');
  }
}

function validateGaaMeta(meta: GaaEnvelope<unknown>['meta']) {
  assert.equal(meta.dataset, 'gaa');
  assert.equal(meta.currency, 'PHP');
  assert.equal(meta.scale, 'pesos');
  assert.deepEqual(meta.years, [...GAA_YEARS]);
}

export async function collectSnapshot(client: Client, portal: PortalConfig = config) {
  const scope = antipoloScope(portal); // Must run before any requests.
  sourceUrl(client.base);
  assert.equal(new URL(client.base).origin, client.base, 'API base must be an HTTPS origin without a path, query or fragment');
  const collectedAt = new Date().toISOString();
  const overview = await client.overview();
  const validateMeta = (meta: Meta) => {
    assert.equal(meta.dataset, 'hgab');
    assert.equal(meta.fiscal_year, 2027);
    assert.equal(meta.currency, 'PHP');
    assert.equal(meta.scale, 'pesos');
    assert.ok(text(meta.source_commit) && text(meta.notice) && Number.isFinite(Date.parse(meta.built_at)), 'Missing source version/date/notice');
    sourceUrl(meta.source_repo);
    for (const field of ['source_repo', 'source_commit', 'built_at'] as const) {
      assert.equal(meta[field], overview.meta[field], 'Source version changed during collection');
    }
  };
  validateMeta(overview.meta);
  const glossary = JSON.parse(await readFile(glossaryPath, 'utf8')) as GlossaryEntry[];
  assert.ok(Array.isArray(glossary) && glossary.length > 0, 'Missing reviewed glossary');
  unique(glossary.map((entry) => entry.id), 'glossary IDs');
  for (const entry of glossary) {
    assert.ok(entry.id.startsWith('glossary:') && [entry.term, entry.fil, entry.en].every(text), 'Malformed glossary entry');
    assert.ok(Array.isArray(entry.aliases) && entry.aliases.length && entry.aliases.every(text), 'Missing glossary aliases');
    assert.ok(Number.isFinite(Date.parse(entry.reviewedAt)), 'Missing glossary review date');
    assert.ok(Array.isArray(entry.sources) && entry.sources.length, 'Missing glossary references');
    entry.sources.forEach((url) => sourceUrl(url));
  }
  const queries: { kind: 'hgab' | 'gaa'; api: string; matched: number; fetched: number; complete: true; meta: Meta | GaaEnvelope<unknown>['meta'] }[] = [];
  let gaaMeta: GaaEnvelope<unknown>['meta'] | undefined;
  const familyIds = new Set<string>();
  // Validate raw results BEFORE the resolvers merge IDs or omit empty queries.
  const checked: Client = {
    ...client,
    allProjects: async (dataset, params) => {
      const result = await client.allProjects(dataset, params);
      const { list, rows, truncated } = result;
      validateMeta(list.meta);
      assert.ok(!truncated && integer(list.data.total) && rows.length === list.data.total, 'Incomplete/truncated project query');
      unique(rows.map((row) => row.id), 'project IDs');
      rows.forEach((row) => validateProject(row, dataset, client.base));
      for (const disclaimer of list.disclaimers) {
        assert.ok([disclaimer.id, disclaimer.title, disclaimer.body].every(text), 'Malformed disclaimer');
        sourceUrl(disclaimer.url);
      }
      queries.push({ kind: 'hgab', api: client.href(`/datasets/${dataset}/projects`, params), matched: list.data.total, fetched: rows.length, complete: true, meta: list.meta });
      return result;
    },
    gaaDepartments: async () => {
      const result = await client.gaaDepartments();
      validateGaaMeta(result.meta);
      assert.ok(Array.isArray(result.data) && result.data.length > 0, 'Missing GAA departments');
      assert.equal(result.next_cursor ?? null, null, 'Truncated department list');
      assert.equal(result.meta.total_items, result.data.length, 'Incomplete department list');
      unique(result.data.map((d) => d.id), 'department IDs');
      for (const department of result.data) {
        assert.ok(text(department.description) && text(department.slug), 'Missing department labels');
        validateYears(department.years);
      }
      gaaMeta = result.meta;
      return result;
    },
    gaaPrograms: async (departmentId, q) => {
      const result = await client.gaaPrograms(departmentId, q);
      const { first, rows, truncated } = result;
      validateGaaMeta(first.meta);
      assert.ok(!truncated && integer(first.meta.matched) && first.meta.matched === rows.length, 'Incomplete/truncated GAA query');
      unique(rows.map((row) => row.fam_key), 'GAA family IDs');
      for (const row of rows) {
        assert.equal(row.department_id, departmentId, 'GAA family returned in the wrong department');
        assert.ok(text(row.agency_id) && text(row.name) && integer(row.ids_count) && row.ids_count > 0, 'Malformed GAA family');
        validateYears(row.years);
        assert.ok(!familyIds.has(row.fam_key), 'Duplicate/conflicting GAA family across departments');
        familyIds.add(row.fam_key);
      }
      queries.push({ kind: 'gaa', api: client.href(`/api/v1/gaa/departments/${departmentId}/programs`, { q }), matched: rows.length, fetched: rows.length, complete: true, meta: first.meta });
      return result;
    },
  };
  const [projects, gaa] = await Promise.all([resolveScope(checked, portal), resolveGaa(checked, portal)]);
  for (const excluded of projects.excluded) assert.ok(excluded.project, `Unmatched exclusion: ${excluded.exclusion.key}`);
  for (const excluded of gaa.excluded) assert.ok(excluded.row, `Unmatched exclusion: ${excluded.exclusion.key}`);
  assert.equal(queries.length, DATASET_KEYS.length + gaa.departments.length, 'Missing required queries');
  assert.ok(gaaMeta);
  // Stable ordering makes IDs independent of network completion order.
  queries.sort((a, b) => a.api.localeCompare(b.api));
  projects.projects.sort((a, b) => a.key.localeCompare(b.key));
  gaa.rows.sort((a, b) => a.key.localeCompare(b.key));
  const reference = {
    recordVersions: overview.data.record_versions,
    documents: overview.data.documents,
    rules: overview.data.rules,
    terms: overview.data.terms,
    datasets: overview.data.datasets.map((d) => ({
      key: d.key, label: d.label, short: d.short, agency: d.agency,
      houseStage: d.house_stage, houseStageLabel: d.house_stage_label,
      groups: BRIDGE_GROUPS.map((group) => {
        const { label, sub, help } = d.bridge.groups[group];
        assert.ok([label, sub, help].every(text), 'Missing published comparison help');
        return { group, label, sub, help };
      }),
    })),
  };
  assert.deepEqual(reference.datasets.map((d) => d.key).sort(), [...DATASET_KEYS].sort(), 'Incomplete program reference');
  for (const dataset of reference.datasets) {
    assert.ok([dataset.label, dataset.short, dataset.agency, dataset.houseStageLabel].every(text), 'Missing program labels');
    assert.equal(dataset.houseStage, dataset.key === 'dpwh' ? 'hgab3' : 'hgab2', 'Unexpected House comparison stage');
  }
  unique(reference.recordVersions.map((v) => v.key), 'budget version IDs');
  assert.deepEqual(reference.recordVersions.map((v) => v.key).sort(), ['api', 'hgab2', 'hgab3', 'nep']);
  for (const version of reference.recordVersions) assert.ok([version.label, version.short, version.plain].every(text), 'Missing budget version labels');
  assert.ok(reference.documents.length > 0 && reference.rules.length > 0, 'Missing budget documents/rules');
  unique(reference.documents.map((d) => d.key), 'document IDs');
  for (const document of reference.documents) {
    assert.ok(text(document.title) && text(document.stage), 'Malformed document');
    sourceUrl(document.pdf_url);
    if (document.source_url !== null) sourceUrl(document.source_url);
  }
  const content = {
    manifest: {
      schemaVersion: 1,
      portalId: portal.id,
      scope,
      scopeFingerprint: hash({ portalId: portal.id, scope }),
      apiBase: client.base,
      fiscalYears: { comparison: 2027, enacted: [...GAA_YEARS] },
      budgetStages: { comparison: ['nep', 'hgab2', 'hgab3', 'api'], enacted: 'gaa' },
      sourceVersions: { hgab: overview.meta, gaa: { ...gaaMeta, source_commit: gaaMeta.source_commit ?? null, built_at: gaaMeta.built_at ?? null } },
      counts: {
        projects: projects.projects.length, gaaFamilies: gaa.rows.length, glossary: glossary.length,
        excludedProjects: projects.excluded.length, excludedFamilies: gaa.excluded.length,
        regionOmitted: projects.queries.reduce((sum, query) => sum + query.total - query.kept, 0),
        departmentsSearched: gaa.searched,
      },
      queryCompleteness: { complete: true, queries },
    },
    reference, projects,
    gaa: { ...gaa, departments: gaa.departments.map(({ id, slug, description }) => ({ id, slug, description })) },
    glossary,
  };
  return { ...content, manifest: { ...content.manifest, snapshotId: `sha256:${hash(content)}`, collectedAt } };
}

export type EvidenceSnapshot = Awaited<ReturnType<typeof collectSnapshot>>;

/** Shared by the offline collector checks and the server's once-per-instance load. */
export function validateSnapshot(snapshot: EvidenceSnapshot, portal: PortalConfig = config) {
  const { manifest: m, projects, gaa, reference, glossary } = snapshot;
  const { snapshotId, collectedAt, ...manifest } = m;
  assert.equal(m.schemaVersion, 1, 'Unsupported snapshot schema');
  assert.equal(m.portalId, portal.id);
  assert.deepEqual(m.scope, antipoloScope(portal), 'Snapshot scope changed; refresh it');
  assert.equal(m.scopeFingerprint, hash({ portalId: portal.id, scope: m.scope }));
  assert.ok(Number.isFinite(Date.parse(collectedAt)), 'Invalid collection date');
  sourceUrl(m.apiBase);
  assert.equal(new URL(m.apiBase).origin, m.apiBase);
  assert.deepEqual(m.fiscalYears, { comparison: 2027, enacted: [...GAA_YEARS] });
  assert.deepEqual(m.budgetStages, { comparison: ['nep', 'hgab2', 'hgab3', 'api'], enacted: 'gaa' });
  assert.equal(m.queryCompleteness.complete, true, 'Incomplete snapshot');
  const queries = m.queryCompleteness.queries;
  unique(queries.map((q) => q.api), 'snapshot queries');
  assert.equal(queries.length, DATASET_KEYS.length + gaa.departments.length);
  for (const q of queries) {
    sourceUrl(q.api);
    assert.ok(q.complete && integer(q.matched) && q.matched === q.fetched, 'Incomplete snapshot query');
  }
  assert.equal(m.counts.projects, projects.projects.length);
  assert.equal(m.counts.gaaFamilies, gaa.rows.length);
  assert.equal(m.counts.glossary, glossary.length);
  assert.equal(m.counts.departmentsSearched, gaa.departments.length);
  assert.equal(m.counts.excludedProjects, projects.excluded.length);
  assert.equal(m.counts.excludedFamilies, gaa.excluded.length);
  assert.equal(m.counts.regionOmitted, projects.queries.reduce((sum, q) => sum + q.total - q.kept, 0));
  unique([...projects.projects, ...gaa.rows].map((r) => r.key), 'snapshot record IDs');
  assert.deepEqual(reference.datasets.map((d) => d.key).sort(), [...DATASET_KEYS].sort());
  assert.deepEqual(reference.recordVersions.map((v) => v.key).sort(), ['api', 'hgab2', 'hgab3', 'nep']);
  for (const version of reference.recordVersions) assert.ok([version.label, version.short, version.plain].every(text));
  for (const dataset of reference.datasets) {
    assert.ok([dataset.label, dataset.short, dataset.agency, dataset.houseStageLabel].every(text));
    assert.equal(dataset.houseStage, dataset.key === 'dpwh' ? 'hgab3' : 'hgab2');
  }
  assert.deepEqual(projects.queries.map((q) => q.dataset).sort(), [...DATASET_KEYS].sort());
  for (const q of projects.queries) {
    assert.ok(!q.truncated && q.kind === 'place' && q.label === 'Antipolo City' && q.region === 'IV-A');
    assert.deepEqual(q.params, { q: 'Antipolo City' });
    assert.ok(queries.some((source) => source.kind === 'hgab' && source.api === q.api && source.matched === q.total));
  }
  const excluded = new Set(m.scope.exclude.map((e) => e.key));
  for (const row of projects.projects) {
    validateProject(row, row.dataset, m.apiBase);
    assert.ok(DATASET_KEYS.includes(row.dataset));
    assert.equal(row.key, `${row.dataset}:${row.id}`);
    assert.ok(!excluded.has(row.key) && (row.region_key === null || row.region_key === 'IV-A'));
    assert.deepEqual(row.reasons, [{ kind: 'place', label: 'Antipolo City' }]);
  }
  for (const row of gaa.rows) {
    assert.equal(row.key, `gaa:${row.fam_key}`);
    assert.ok(text(row.fam_key) && text(row.name) && text(row.agency_id) && text(row.department) && !excluded.has(row.key));
    validateYears(row.years);
    assert.deepEqual(row.reasons, ['Antipolo City']);
    assert.ok(gaa.queries.some((q) => q.department_id === row.department_id && row.reasons.includes(q.place)), 'Missing family provenance');
  }
  for (const q of gaa.queries) {
    assert.ok(!q.truncated && q.place === 'Antipolo City' && q.q === 'Antipolo City');
    assert.ok(queries.some((source) => source.kind === 'gaa' && source.api === q.api && source.matched === q.matched && q.matched === q.fetched));
    sourceUrl(q.api);
  }
  unique(glossary.map((g) => g.id), 'glossary IDs');
  for (const id of ['glossary:appropriation-not-spending', 'glossary:antipolo-coverage', 'glossary:comparison-candidates']) {
    assert.ok(glossary.some((g) => g.id === id), 'Missing required reviewed reference');
  }
  for (const entry of glossary) {
    assert.ok(entry.id.startsWith('glossary:') && [entry.term, entry.fil, entry.en].every(text));
    assert.ok(entry.aliases.length && entry.aliases.every(text) && entry.sources.length);
    assert.ok(Number.isFinite(Date.parse(entry.reviewedAt)));
    entry.sources.forEach((url) => sourceUrl(url));
  }
  assert.equal(snapshotId, `sha256:${hash({ ...snapshot, manifest })}`, 'Snapshot content hash mismatch');
}

export async function buildSnapshot(client: Client, portal: PortalConfig = config, output = outputPath) {
  const snapshot = await collectSnapshot(client, portal);
  validateSnapshot(snapshot, portal);
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, output); // Same-directory rename: last good file survives any collection failure.
  } finally {
    await rm(temporary, { force: true });
  }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const client = createClient(process.env.VITE_API_BASE || config.api || DEFAULT_API);
  buildSnapshot(client).then((snapshot) => {
    const { schemaVersion, snapshotId, collectedAt, scopeFingerprint, counts } = snapshot.manifest;
    console.log(JSON.stringify({ schemaVersion, snapshotId, collectedAt, scopeFingerprint, counts }, null, 2));
    console.log('FY2027 (versions compared, never added):', summarise(snapshot.projects.projects));
    console.log('Enacted GAA totals:', gaaYearTotals(snapshot.gaa.rows));
  }).catch((error: unknown) => {
    // The API's error body is untrusted. Do not echo it or environment values.
    if (error instanceof Error && error.name === 'AssertionError') console.error(error.message.split('\n')[0]);
    console.error('RAG collection/validation failed; the last good snapshot was retained. Run npm run check to diagnose source queries.');
    process.exitCode = 1;
  });
}
