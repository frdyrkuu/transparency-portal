/** Offline, scoped evidence and arithmetic. No provider or user-supplied evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateSnapshot, type EvidenceSnapshot, type GlossaryEntry } from '../scripts/build-rag.ts';
import { GAA_YEARS } from '../src/api/types.ts';
import type { ChatRequest, ChatResponse, Fact, Source, Stage } from '../src/api/chat-types.ts';
import { departmentShort, gaaYearTotals, type GaaRow } from '../src/lib/gaa.ts';
import { summarise, type ScopedProject } from '../src/lib/scope.ts';

export type { Language, Stage, Fact, Source } from '../src/api/chat-types.ts';
export type RagRequest = Pick<ChatRequest, 'message' | 'language' | 'context' | 'filters'>;
export type Evidence =
  | { kind: 'project'; key: string; title: string; record: ScopedProject; sourceIds: string[] }
  | { kind: 'gaa'; key: string; title: string; record: GaaRow; sourceIds: string[] }
  | { kind: 'glossary'; key: string; title: string; record: GlossaryEntry; sourceIds: string[] };
export interface RagResult extends Pick<ChatResponse, 'answer' | 'facts' | 'sources' | 'snapshot' | 'provenance'> {
  mode: 'reference' | 'clarification' | 'no_data';
  evidence: Evidence[];
  allowedSourceIds: string[];
  allowedFactIds: string[];
  needsExplanation: boolean;
}

let bundled: Promise<EvidenceSnapshot> | undefined;
export function loadSnapshot(): Promise<EvidenceSnapshot> {
  return bundled ??= readFile(new URL('../data/rag/antipolo.json', import.meta.url), 'utf8').then((json) => {
    const snapshot = JSON.parse(json) as EvidenceSnapshot;
    validateSnapshot(snapshot);
    return snapshot;
  });
}

export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ').replace(/\bfy(\d{4})\b/g, 'fy $1');
}
const phrase = (haystack: string, needle: string) => (` ${haystack} `).includes(` ${normalize(needle)} `);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const synonyms = [
  ['road', 'roads', 'kalsada', 'daan'], ['bridge', 'bridges', 'tulay'],
  ['hospital', 'hospitals', 'ospital'], ['school', 'schools', 'paaralan', 'eskwelahan'],
  ['flood', 'baha'], ['irrigation', 'irigasyon'], ['health', 'kalusugan'],
];
const canonical = new Map(synonyms.flatMap(([word, ...aliases]) => [word, ...aliases].map((alias) => [alias, word] as const)));
const stop = new Set(normalize(`a an the of for in on at to and or is are was were this that it its about with by from
  ano ang mga ng sa para kay ni at o ay ba po ho naman itong ito iyan iyong yan yung tungkol lungsod
  magkano ilan ilang bilang kabuuan kabuuang lahat total totals sum count budget budgets pondo pondong halaga halagang amount amounts money
  project projects proyekto proyektong programa program programs records record tala nakalista nakalistang
  may mayroon meron bang any there list lists show find hanap hanapin maghanap makita tingnan please pakisabi
  explain explanation ipaliwanag paliwanag mo akin ko ang isang what which how much many does do can you me sino who kailan when
  compare comparison comparing versus vs difference differences pagkakaiba pinagkaiba ihambing pagitan mas simple simpleng simpler
  ibig sabihin kahulugan define definition meaning between
  nep house bill version versions bersiyon reading gaa enacted proposed appropriation appropriations fiscal year fy taon taong
  antipolo city rizal barangay brgy completed complete completion finished tapos natapos na spent spending nagastos ginastos
  contractor kontratista procurement disbursement corruption corrupt anomalya irregularity`).split(' '));
const words = (text: string) => [...new Set(normalize(text).split(' ').filter((w) => w && !stop.has(w) && !/^\d{4}$/.test(w)).map((w) => canonical.get(w) ?? w))];
const stageAliases: [Stage, string[]][] = [
  ['nep', ['nep', 'national expenditure program', 'panukalang budget', 'proposed budget']],
  ['hgab2', ['hgab2', 'second reading', 'ikalawang pagbasa']],
  ['hgab3', ['hgab3', 'third reading', 'ikatlong pagbasa']],
  ['house', ['house', 'house bill', 'house version']],
  ['gaa', ['gaa', 'general appropriations act', 'enacted budget', 'batas na budget']],
  ['api', ['transparency website', 'api listing']],
];
const coverage = {
  fil: 'Mga pambansang tala na tumutugma sa saklaw ng portal; hindi ito ang buong budget ng Antipolo City Hall o tala ng aktuwal na paggastos.',
  en: 'National records matching this portal’s scope; this is not the complete Antipolo City Hall budget or a record of actual spending.',
};

/** A supplied snapshot is for offline fixtures; it receives the same validation as the bundle. */
export async function retrieve(request: RagRequest, supplied?: EvidenceSnapshot): Promise<RagResult> {
  const data = supplied ?? await loadSnapshot();
  if (supplied) validateSnapshot(supplied);
  assert.ok(request && typeof request.message === 'string' && request.message.trim() && request.message.length <= 500, 'Invalid question');
  assert.ok(request.language === undefined || request.language === 'fil' || request.language === 'en', 'Invalid language');
  const lang = request.language ?? 'fil';
  const say = (fil: string, en: string) => lang === 'fil' ? fil : en;
  const filter: RagResult['provenance']['filter'] = { year: null, stages: [], program: null, projectKey: null, keywords: [] };
  const sources = new Map<string, Source>();
  const evidence: Evidence[] = [];
  const facts: Fact[] = [];
  const all = [
    ...data.projects.projects.map((record) => ({ kind: 'project' as const, key: record.key, title: record.title, record })),
    ...data.gaa.rows.map((record) => ({ kind: 'gaa' as const, key: record.key, title: record.name, record })),
  ];
  let matched: typeof all = [];
  const finish = (mode: RagResult['mode'], answer: string, needsExplanation = false): RagResult => ({
    mode, answer, facts, sources: [...sources.values()], evidence,
    allowedSourceIds: [...new Set(evidence.flatMap((e) => e.sourceIds).concat(facts.flatMap((f) => f.sourceIds)))],
    allowedFactIds: facts.map((f) => f.id), needsExplanation,
    snapshot: {
      id: data.manifest.snapshotId, collectedAt: data.manifest.collectedAt,
      stale: Date.now() - Date.parse(data.manifest.collectedAt) > 7 * 86400000,
      notice: say('Snapshot ito, hindi live na datos. Maaaring mas bago ang nasa portal. Hindi garantiya ang petsa ng pagkuha na bagong buo ang pinagmulang datos.',
        'This is a snapshot, not live data. The portal may be newer. Collection time does not establish when the upstream data was rebuilt.'),
    },
    provenance: { snapshotId: data.manifest.snapshotId, filter, matchedCount: matched.length, recordKeys: matched.map((r) => r.key), sourceIds: [...sources.keys()], coverage: coverage[lang] },
  });
  const clarify = (fil: string, en: string) => finish('clarification', say(fil, en));
  const noData = () => finish('no_data', say('Walang katugmang tala sa snapshot para sa hiniling na filter. Hindi ito patunay na walang proyekto. Maaaring mas bago ang nasa portal.',
    'No snapshot record matches the requested filter. This does not prove that a project does not exist; the portal may have newer data.'));
  const addSource = (source: Source) => { sources.set(source.id, source); return source.id; };
  const addGlossary = (id: string) => {
    const entry = data.glossary.find((g) => g.id === id)!;
    const sourceIds = entry.sources.map((url, i) => addSource({ id: `${id}:source:${i}`, title: entry.term, url }));
    evidence.push({ kind: 'glossary', key: id, title: entry.term, record: entry, sourceIds });
    return entry[lang];
  };
  // Membership is checked even when a new question supersedes old context.
  const options = request.filters ?? {};
  for (const key of [request.context?.projectKey, options.projectKey]) {
    if (key !== undefined && (typeof key !== 'string' || !all.some((r) => r.key === key))) return noData();
  }
  const q = normalize(request.message);
  const named = all.filter((r) => phrase(q, r.title) || q === normalize(r.kind === 'project' ? r.record.id : r.record.fam_key));
  const exactKeys = all.filter((r) => {
    const index = request.message.indexOf(r.key);
    return index >= 0 && !/[\p{L}\p{N}:|_-]/u.test(request.message[index - 1] ?? '')
      && !/[\p{L}\p{N}:|_-]/u.test(request.message[index + r.key.length] ?? '');
  });
  if (exactKeys.length > 1) return clarify('Pumili muna ng isang project ID.', 'Please select one project ID.');
  // An unknown key must never fall through to a similarly named record.
  const withoutKeys = exactKeys.reduce((message, r) => message.replaceAll(r.key, ''), request.message);
  if (/\b(?:dpwh|hfep|fmr|nia|gaa):/i.test(withoutKeys)) return noData();
  // Official titles/IDs identify evidence, not requested filters or claims.
  // E.g. FMR in a GAA title must not select the separate FY2027 FMR dataset.
  const intent = named.length === 1
    ? ` ${normalize(withoutKeys)} `.replaceAll(` ${normalize(named[0].title)} `, ' ').trim()
    : normalize(withoutKeys);
  const definition = /\b(ibig sabihin|kahulugan|define|definition|meaning|what is|what are|ano ang|pagkakaiba|pinagkaiba)\b/.test(intent);
  const numeric = /\b(magkano|halaga|halagang|amount|how much|total|totals|kabuuan|kabuuang|sum|ilan|ilang|how many|count|difference|compare|ihambing|pagkakaiba|pinagkaiba)\b/.test(intent);
  const aggregate = /\b(total|totals|kabuuan|kabuuang|sum|lahat|all|ilan|ilang|how many|count)\b/.test(intent);
  const plural = aggregate || /\b(mga|projects|records|list|show|find|any|may|mayroon|meron)\b/.test(intent);
  const comparison = /\b(compare|comparison|versus|vs|difference|ihambing|pagkakaiba|pinagkaiba)\b/.test(intent);
  const limitation = /\b(tapos|natapos|completion|completed|complete|finished|nagastos|ginastos|spent|spending|contractor|kontratista|procurement|disbursement|corruption|corrupt|anomalya|irregularity)\b/.test(intent);
  const glossaryEntries = data.glossary.filter((g) => g.aliases.some((alias) => phrase(q, alias)));
  let definitionRemainder = q;
  for (const entry of glossaryEntries) for (const alias of [...entry.aliases].sort((a, b) => b.length - a.length)) {
    definitionRemainder = ` ${definitionRemainder} `.replaceAll(` ${normalize(alias)} `, ' ').trim();
  }
  if ((definition || glossaryEntries.some((g) => g.aliases.some((alias) => normalize(alias) === q)))
    && !/\b(magkano|halaga|halagang|amount|how much|total|totals|kabuuan|kabuuang|sum|ilan|ilang|count)\b/.test(q)
    && !words(definitionRemainder).length && !exactKeys.length && !named.length && !options.projectKey && !Object.keys(options).length) {
    if (glossaryEntries.length) return finish('reference', glossaryEntries.slice(0, 6).map((g) => addGlossary(g.id)).join('\n\n'));
  }
  let query = intent;
  const queryYears = [...new Set(query.match(/\b(?:19|20|21)\d{2}\b/g) ?? [])].map(Number);
  if (queryYears.length > 1) return clarify('Pumili ng isang taon; magkahiwalay ang mga halaga bawat taon.', 'Choose one fiscal year; amounts are kept separate by year.');
  if (options.year !== undefined && (!Number.isSafeInteger(options.year) || (queryYears.length && options.year !== queryYears[0]))) {
    return clarify('Hindi tugma ang filter at ang taon sa tanong. Aling taon ang gusto mo?', 'The year filter conflicts with the question. Which fiscal year do you mean?');
  }
  filter.year = options.year ?? queryYears[0] ?? null;
  if (filter.year !== null && ![2027, ...GAA_YEARS].includes(filter.year)) return noData();
  let stages = stageAliases.filter(([, aliases]) => aliases.some((alias) => phrase(query, alias))).map(([stage]) => stage);
  if (stages.includes('hgab2') || stages.includes('hgab3')) stages = stages.filter((stage) => stage !== 'house');
  if (options.stage !== undefined) {
    if (!stageAliases.some(([stage]) => stage === options.stage) || (stages.length && !stages.includes(options.stage))) {
      return clarify('Hindi tugma o hindi kilala ang bersiyon ng budget. NEP, House bill, o GAA?', 'The budget version is unknown or conflicting. NEP, House bill, or GAA?');
    }
    stages = [options.stage];
  }
  filter.stages = stages;
  if ((stages.includes('gaa') && stages.some((s) => s !== 'gaa')) || (stages.includes('gaa') && filter.year === 2027)
    || (filter.year !== null && filter.year < 2027 && stages.some((s) => s !== 'gaa'))) {
    return clarify('Hindi tugma ang taon at bersiyon. NEP/House ang 2027; GAA ang 2020–2026.', 'The year and version conflict: 2027 has NEP/House records; 2020–2026 has GAA records.');
  }
  if (stages.length) for (const [stage, aliases] of stageAliases) {
    if (stages.includes(stage)) for (const alias of [...aliases].sort((a, b) => b.length - a.length)) query = ` ${query} `.replaceAll(` ${normalize(alias)} `, ' ').trim();
  }

  // Program selectors reuse the snapshot's labels, including GAA department names.
  const programs = new Map<string, Set<string>>();
  const programAliases = new Set<string>();
  const register = (label: string | null, keys: string[], automatic = false) => {
    if (!label) return;
    const alias = normalize(label);
    const ids = programs.get(alias) ?? new Set<string>();
    keys.forEach((key) => ids.add(key));
    programs.set(alias, ids);
    if (automatic) programAliases.add(alias);
  };
  for (const d of data.reference.datasets) {
    const keys = data.projects.projects.filter((r) => r.dataset === d.key).map((r) => r.key);
    [d.key, d.short, d.label].forEach((alias) => register(alias, keys, true));
    register(d.agency, [...keys, ...data.gaa.rows.filter((r) => phrase(normalize(r.department), d.agency)).map((r) => r.key)], true);
  }
  for (const d of data.gaa.departments) {
    const keys = data.gaa.rows.filter((r) => r.department_id === d.id).map((r) => r.key);
    [d.id, d.slug, d.description, departmentShort(d.description)].forEach((alias) => register(alias, keys, true));
  }
  for (const r of all) register(r.kind === 'project' ? r.record.program : r.record.agency_id, [r.key]);
  const mentionedPrograms = [...programAliases].filter((alias) => alias.length > 2 && !/^\d+$/.test(alias) && phrase(query, alias));
  // Longer labels contain their abbreviations; remove contained duplicate selectors.
  const programNames = mentionedPrograms.filter((alias) => !mentionedPrograms.some((other) => other !== alias && phrase(other, alias)));
  if (options.program !== undefined) {
    if (typeof options.program !== 'string' || !programs.has(normalize(options.program))) return clarify('Aling programa o ahensiya? Gamitin ang pangalan o ID sa tala.', 'Which program or agency? Use a name or ID from the records.');
    const selected = normalize(options.program);
    if (programNames.some((name) => name !== selected && !phrase(name, selected) && !phrase(selected, name)
      && !(programs.get(name)!.size === programs.get(selected)!.size && [...programs.get(name)!].every((key) => programs.get(selected)!.has(key))))) {
      return clarify('Magkaiba ang programa sa filter at tanong. Alin ang gusto mo?', 'The program filter and question differ. Which one do you mean?');
    }
    filter.program = selected;
  } else if (programNames.length > 1) return clarify('Pumili muna ng isang programa o ahensiya.', 'Please choose one program or agency.');
  else filter.program = programNames[0] ?? null;
  for (const name of programNames) query = ` ${query} `.replaceAll(` ${name} `, ' ').trim();

  // ponytail: explicit city phrases + common city names, not a geography parser; add reviewed aliases after observed misses.
  const otherCity = /\b(?:city of|lungsod ng) (?!antipolo\b)[\p{L}]+|\b(?!antipolo\b)[\p{L}]+ city\b/gu;
  const cityMentions = [...q.matchAll(otherCity)].filter((m) => m[0] !== 'city budget' && m[0] !== 'whole city');
  if (!exactKeys.length && !all.some((r) => phrase(q, r.title))
    && (cityMentions.length || /\b(?:budget (?:ng|of)|sa|in) (?:manila|cebu|davao|quezon|pasig|marikina|lipa|batangas)\b/.test(q))) {
    return finish('reference', addGlossary('glossary:antipolo-coverage'));
  }
  const tokens = words(query);
  filter.keywords = tokens;
  let selected: string | undefined = options.projectKey ?? exactKeys[0]?.key;
  if (options.projectKey && named.length && !named.some((r) => r.key === options.projectKey)) return clarify('Magkaiba ang proyekto sa filter at tanong. Alin ang gusto mo?', 'The project filter and question name different projects. Which one do you mean?');
  if (!selected && named.length === 1) selected = named[0].key;
  if (!selected && !tokens.length && !plural) selected = request.context?.projectKey;
  if (selected) filter.projectKey = selected;
  if (selected && exactKeys.length && selected !== exactKeys[0].key) return clarify('Magkaiba ang project ID sa filter at tanong. Alin ang gusto mo?', 'The project filter and question name different IDs. Which one do you mean?');

  let candidates = all.filter((r) => (!selected || r.key === selected)
    && (filter.year === null || (r.kind === 'project' ? filter.year === 2027 : filter.year < 2027))
    && (!stages.length || (r.kind === 'project' ? !stages.includes('gaa') : stages.includes('gaa')))
    && (filter.program === null || programs.get(filter.program)!.has(r.key)));
  if (!selected && tokens.length) {
    // ponytail: AND keyword matching favors precision; expand reviewed synonyms if pilot questions miss records.
    candidates = candidates.filter((r) => {
      const hay = new Set(words(`${r.title} ${r.kind === 'project' ? r.record.program ?? '' : r.record.department}`));
      return tokens.every((token) => hay.has(token));
    });
  }
  if (!selected && !tokens.length && !plural && !filter.program) {
    if (limitation) return finish('reference', addGlossary('glossary:appropriation-not-spending'));
    return clarify('Aling proyekto, programa, o taon ang gusto mo? Para sa halaga, tukuyin din kung NEP, House bill, o GAA. Hindi ito ang buong budget ng City Hall.',
      'Which project, program, or fiscal year do you mean? For an amount, also choose NEP, House bill, or GAA. These records are not the complete City Hall budget.');
  }
  if (!candidates.length) return noData();
  const rank = (r: (typeof all)[number]) => {
    const title = words(r.title);
    return Number(phrase(normalize(r.title), query)) * 100 + Number(phrase(title.join(' '), tokens.join(' '))) * 20
      + tokens.reduce((score, token) => score + (title.includes(token) ? 3 : 1), 0);
  };
  candidates.sort((a, b) => rank(b) - rank(a) || a.key.localeCompare(b.key));
  matched = candidates;
  const years = new Set(candidates.map((r) => r.kind === 'project' ? '2027' : '2020–2026'));
  if ((!selected && years.size > 1) || (aggregate && filter.year === null && candidates.some((r) => r.kind === 'gaa'))) {
    return clarify('Anong taon ang gusto mo? May NEP/House para sa 2027 at GAA para sa 2020–2026. Hindi pinagsasama ang mga taon.',
      'Which fiscal year? NEP/House covers 2027 and GAA covers 2020–2026. Years are not added together.');
  }
  if (!selected && !plural && candidates.length > 1) {
    for (const r of candidates.slice(0, 6)) addRecord(r);
    return clarify('Maraming katugmang pangalan. Piliin ang project ID o magbigay ng mas tiyak na pangalan o barangay.', 'Several records match. Select a project ID or give a more specific name or barangay.');
  }
  if (numeric && !limitation && candidates.some((r) => r.kind === 'project') && !stages.length && !comparison) {
    return clarify('NEP o House bill ang gusto mong halaga? Magkaibang bersiyon ito at hindi pinagsasama.', 'Do you mean the NEP or House bill amount? They are separate versions and are never added together.');
  }

  function recordSources(r: (typeof all)[number]): string[] {
    if (r.kind === 'gaa') return data.gaa.queries.filter((source) => source.department_id === r.record.department_id && r.record.reasons.includes(source.place)).map((source) => addSource({
      id: `source:${r.key}:${digest(source.api)}`, title: `${r.title} — ${r.record.department}; ${r.record.agency_id}; ${r.record.fam_key}`, url: source.api, recordKey: r.key,
    }));
    const p = r.record;
    const ids = [addSource({ id: `source:${r.key}:api`, title: p.title, url: new URL(p.api_url, data.manifest.apiBase).href, recordKey: r.key })];
    for (const stage of ['nep', 'hgab2', 'hgab3', 'api'] as const) {
      const url = p.pdf_url[stage];
      if (url) ids.push(addSource({ id: `source:${r.key}:${stage}`, title: `${p.title} — ${stage}`, url, recordKey: r.key,
        ...(stage !== 'api' && p[`${stage}_page`] !== null ? { page: p[`${stage}_page`]! } : {}),
      }));
    }
    return ids;
  }
  function addRecord(r: (typeof all)[number]) {
    const sourceIds = recordSources(r);
    evidence.push({ ...r, sourceIds } as Evidence);
  }
  // All matching records contribute to provenance and sums, before the six-record evidence cap.
  const perRecordSources = new Map(candidates.map((r) => [r.key, recordSources(r)]));
  const caution = candidates.some((r) => r.kind === 'project' && (r.record.held || ['house_only', 'nep_only', 'scope_review'].includes(r.record.bridge_group)));
  const evidenceLimit = 6 - Number(limitation) - Number(caution);
  for (const r of candidates.slice(0, evidenceLimit)) addRecord(r);
  const factPrefix = `fact:${digest([data.manifest.snapshotId, filter, candidates.map((r) => r.key)])}`;
  const addFact = (fact: Omit<Fact, 'id'>) => {
    assert.ok(fact.value === null || Number.isSafeInteger(fact.value), 'Unsafe financial total');
    facts.push({ ...fact, id: `${factPrefix}:${fact.recordKey ?? 'aggregate'}:${fact.year}:${fact.stage}:${fact.kind}` });
  };
  const idsFor = (rows: { key: string }[]) => [...new Set(rows.flatMap((r) => perRecordSources.get(r.key)!))];
  const projectRows = candidates.filter((r) => r.kind === 'project').map((r) => r.record);
  const gaaRows = candidates.filter((r) => r.kind === 'gaa').map((r) => r.record);
  const batches = aggregate ? [{ projects: projectRows, gaa: gaaRows, recordKey: undefined }]
    : candidates.slice(0, evidenceLimit).map((r) => ({ projects: r.kind === 'project' ? [r.record] : [], gaa: r.kind === 'gaa' ? [r.record] : [], recordKey: r.key }));
  for (const batch of batches) {
    const { projects, gaa, recordKey } = batch;
    if (projects.length) {
      const summary = summarise(projects);
      const versions: Stage[] = stages.length ? stages : ['nep', 'house'];
      const sourceIds = idsFor(projects);
      for (const stage of versions) {
        if (stage === 'gaa') continue;
        const available = stage === 'nep' ? summary.nep.rows : stage === 'house' ? summary.house.rows : projects.filter((p) => p[`${stage}_php`] !== null).length;
        const amount = stage === 'nep' ? summary.nep.php : stage === 'house' ? summary.house.php : projects.reduce((sum, p) => sum + (p[`${stage}_php`] ?? 0), 0);
        const context = { year: 2027, stage, sourceIds, availableCount: available, missingCount: projects.length - available, recordKey };
        const label = stage === 'house' ? [...new Set(projects.map((p) => data.reference.datasets.find((d) => d.key === p.dataset)!.houseStageLabel))].join('; ') : data.reference.recordVersions.find((v) => v.key === stage)!.label;
        addFact({ ...context, kind: 'amount', label: `${aggregate ? say('Kabuuan ng katugmang tala', 'Total of matching records') + ' — ' : ''}${stage === 'house' ? 'House bill — ' : ''}${label}`, value: available ? amount : null, unit: 'PHP' });
        addFact({ ...context, kind: 'count', label: say('Mga talang may nakalistang halaga', 'Records with a listed amount'), value: available, unit: 'records' });
      }
      if (comparison || !numeric) {
        const comparable = projects.every((p) => p.nep_php !== null && p.house_php !== null && !p.held && p.bridge_group !== 'scope_review');
        addFact({ year: 2027, stage: 'house-minus-nep', sourceIds, availableCount: comparable ? projects.length : 0, missingCount: comparable ? 0 : projects.length, recordKey,
          kind: 'difference', label: say('Pagkakaiba: House bill bawas NEP; hindi kumpirmadong pagbabago', 'Difference: House bill minus NEP; not a confirmed change'), value: comparable ? summary.house.php - summary.nep.php : null, unit: 'PHP' });
      }
    }
    if (gaa.length) for (const total of gaaYearTotals(gaa).filter((t) => filter.year === null || t.year === filter.year)) {
      const context = { year: total.year, stage: 'gaa' as const, sourceIds: idsFor(gaa), availableCount: gaa.length, missingCount: 0, recordKey };
      addFact({ ...context, kind: 'amount', label: aggregate ? say('Kabuuang GAA ng katugmang pamilya', 'GAA total of matching families') : 'GAA', value: total.amount, unit: 'PHP' });
      addFact({ ...context, kind: 'count', label: say('Mga pamilyang may halagang higit sa zero', 'Families with an amount above zero'), value: total.programs, unit: 'families' });
    }
  }
  const answer = limitation ? addGlossary('glossary:appropriation-not-spending') : say('Narito ang mga katugmang tala at ang halaga sa bawat taon at bersiyon. Ang nawawalang halaga ay hindi zero.',
    'Here are the matching records and their amounts by fiscal year and version. A missing amount is not zero.');
  const review = caution ? `\n\n${addGlossary('glossary:comparison-candidates')}` : '';
  return finish('reference', `${answer}${review}\n\n${coverage[lang]}`, !limitation && /\b(explain|ipaliwanag|paliwanag|simpleng|simpler)\b/.test(q));
}
