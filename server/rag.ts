/** Offline, scoped evidence and arithmetic. No provider or user-supplied evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateSnapshot, type EvidenceSnapshot, type GlossaryEntry } from '../scripts/build-rag.ts';
import { GAA_YEARS } from '../src/api/types.ts';
import type { ChatRecord, ChatRequest, ChatResponse, Fact, Source, Stage } from '../src/api/chat-types.ts';
import { departmentShort, gaaYearTotals, type GaaRow } from '../src/lib/gaa.ts';
import { summarise, type ScopedProject, type ScopeResult } from '../src/lib/scope.ts';
import { phpFull } from '../src/lib/format.ts';

export type { Language, Stage, Fact, Source } from '../src/api/chat-types.ts';
export type RagRequest = Pick<ChatRequest, 'message' | 'language' | 'context' | 'filters'>;
export type Evidence =
  | { kind: 'project'; key: string; title: string; record: ScopedProject; sourceIds: string[] }
  | { kind: 'gaa'; key: string; title: string; record: GaaRow; sourceIds: string[] }
  | { kind: 'glossary'; key: string; title: string; record: GlossaryEntry; sourceIds: string[] };
export interface RagResult extends Pick<ChatResponse, 'answer' | 'facts' | 'records' | 'sources' | 'snapshot' | 'provenance'> {
  mode: 'reference' | 'clarification' | 'no_data';
  evidence: Evidence[];
  allowedSourceIds: string[];
  allowedFactIds: string[];
  needsExplanation: boolean;
  refreshProjects: boolean;
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
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
    .replace(/\bfy(\d{4})\b/g, 'fy $1').replace(/\bhousebill\b/g, 'house bill').replace(/\bsta\b/g, 'santa').replace(/\bsto\b/g, 'santo');
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
  ano anong aling saan ang mga ng sa para kay ni at o ay ba po ho naman na itong ito iyan iyong yan yung tungkol lungsod where has have
  magkano ilan ilang bilang kabuuan kabuuang lahat all total totals sum count number budget budgets badyet pondo pondong halaga halagang amount amounts money
  project projects proyekto proyektong programa program programs records record lines line tala nakalista nakalistang
  may mayroon meron bang any there list lists show find hanap hanapin maghanap makita tingnan please pakisabi
  explain explanation ipaliwanag paliwanag mo akin ko ang isang what which how much many does do can you me sino who kailan when
  ako bigyan bigay ibigay magbigay pakibigay makahingi paki pwede maaari ninyo inyong inyo gusto nais want would like give provide tell buod ibuod summary overview summarize summarise pangkalahatan
  detalyado detalyadong detailed maikli maikling short brief buong
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
const highestPattern = /\b(?:pinaka ?(?:mataas|malaki(?:ng)?)|highest|largest|biggest|most expensive)\b/g;
const coverage = {
  fil: 'Mga pambansang tala na tumutugma sa saklaw ng portal; hindi ito ang buong budget ng Antipolo City Hall o tala ng aktuwal na paggastos.',
  en: 'National records matching this portal’s scope; this is not the complete Antipolo City Hall budget or a record of actual spending.',
};

/** A supplied snapshot is for offline fixtures; it receives the same validation as the bundle. */
export async function retrieve(request: RagRequest, supplied?: EvidenceSnapshot, live?: { scope: ScopeResult; collectedAt: string }): Promise<RagResult> {
  const data = supplied ?? await loadSnapshot();
  if (supplied) validateSnapshot(supplied);
  assert.ok(request && typeof request.message === 'string' && request.message.trim() && request.message.length <= 500, 'Invalid question');
  assert.ok(request.language === undefined || request.language === 'fil' || request.language === 'en', 'Invalid language');
  const lang = request.language ?? 'fil';
  const projectData = live?.scope ?? data.projects;
  const snapshotId = live ? `api:${digest([projectData.meta, projectData.projects])}` : data.manifest.snapshotId;
  const say = (fil: string, en: string) => lang === 'fil' ? fil : en;
  const filter: RagResult['provenance']['filter'] = { year: null, stages: [], program: null, projectKey: null, keywords: [] };
  const sources = new Map<string, Source>();
  const evidence: Evidence[] = [];
  const facts: Fact[] = [];
  const all = [
    ...projectData.projects.map((record) => ({ kind: 'project' as const, key: record.key, title: record.title, record })),
    ...data.gaa.rows.map((record) => ({ kind: 'gaa' as const, key: record.key, title: record.name, record })),
  ];
  let matched: typeof all = [];
  let refreshProjects = false;
  const finish = (mode: RagResult['mode'], answer: string, needsExplanation = false): RagResult => ({
    mode, answer, facts, sources: [...sources.values()], evidence,
    records: facts.some((fact) => !fact.recordKey) ? [] : evidence.flatMap<ChatRecord>((item) => {
      if (item.kind === 'glossary') return [];
      if (item.kind === 'gaa') return [{ key: item.key, title: item.title, department: item.record.department,
        amounts: Object.entries(item.record.years).filter(([year, value]) => filter.year === null ? value.amount > 0 : Number(year) === filter.year)
          .map(([year, value]) => ({ year: Number(year), stage: 'gaa' as const, value: value.amount })) }];
      const stages: Stage[] = filter.stages.length ? filter.stages : ['nep', 'house'];
      return [{ key: item.key, title: item.title, department: data.reference.datasets.find((dataset) => dataset.key === item.record.dataset)!.agency,
        amounts: stages.filter((stage): stage is Exclude<Stage, 'gaa'> => stage !== 'gaa').map((stage) => ({ year: 2027, stage, value: item.record[`${stage}_php`] })) }];
    }),
    allowedSourceIds: [...new Set(evidence.flatMap((e) => e.sourceIds).concat(facts.flatMap((f) => f.sourceIds)))],
    allowedFactIds: facts.map((f) => f.id), needsExplanation, refreshProjects,
    snapshot: {
      id: snapshotId, collectedAt: live?.collectedAt ?? data.manifest.collectedAt,
      stale: !live && Date.now() - Date.parse(data.manifest.collectedAt) > 7 * 86400000,
      ...(live ? { live: true as const } : {}),
      notice: live ? say('Kinuha ang mga tala sa Budget API. Nakalaang budget ito, hindi tala ng nagastos.', 'Records were fetched from the Budget API. Listed budgets are not records of actual spending.')
        : say('Snapshot ito, hindi live na datos. Maaaring mas bago ang nasa portal. Hindi garantiya ang petsa ng pagkuha na bagong buo ang pinagmulang datos.',
          'This is a snapshot, not live data. The portal may be newer. Collection time does not establish when the upstream data was rebuilt.'),
    },
    provenance: { snapshotId, filter, matchedCount: matched.length, recordKeys: matched.map((r) => r.key), sourceIds: [...sources.keys()], coverage: coverage[lang] },
  });
  const clarify = (fil: string, en: string) => finish('clarification', say(fil, en));
  const noData = () => finish('no_data', say('Paumanhin, wala akong nakitang tugma sa mga talang nasuri. Maaari po ninyong ibigay ang buong pangalan ng kalsada, barangay, o proyekto at ang taon? Hindi ito nangangahulugang walang proyekto sa lugar na iyon.',
    'I’m sorry, I could not find a match in the records checked. Could you please share the full road, barangay or project name and the year? This does not mean that no project exists there.'));
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
  if (exactKeys.length > 1) return clarify('Aling proyekto po ang nais ninyong tingnan? Maaari po ninyong ibigay ang pangalan nito.', 'Which project would you like to check? Please share its name.');
  // An unknown key must never fall through to a similarly named record.
  const withoutKeys = exactKeys.reduce((message, r) => message.replaceAll(r.key, ''), request.message);
  if (/\b(?:dpwh|hfep|fmr|nia|gaa):/i.test(withoutKeys)) return noData();
  // Official titles/IDs identify evidence, not requested filters or claims.
  // E.g. FMR in a GAA title must not select the separate FY2027 FMR dataset.
  const rawIntent = named.length === 1
    ? ` ${normalize(withoutKeys)} `.replaceAll(` ${normalize(named[0].title)} `, ' ').trim()
    : normalize(withoutKeys);
  // ponytail: reviewed spelling variants only; never fuzzy-match place names or project IDs.
  const intent = rawIntent.replace(/\b(kabuuhan|kabuhuan|kabuuuhan)\b/g, 'kabuuan').replace(/\b(projekto|proyektos)\b/g, 'proyekto');
  const definition = /\b(ibig sabihin|kahulugan|define|definition|meaning|what is|what are|ano ang|pagkakaiba|pinagkaiba)\b/.test(intent);
  const highest = Boolean(intent.match(highestPattern));
  const countRequest = /\b(ilan|ilang|bilang|how many|number of|count|kabuuan|kabuuang|total|lahat|all)\b/.test(intent)
    && /\b(project|projects|proyekto|proyektong|record|records|lines|tala|roads?|kalsada|daan|bridges?|tulay|schools?|paaralan|hospitals?|ospital)\b/.test(intent);
  const countQuestion = countRequest && (/\b(ilan|ilang|bilang|how many|number of|count)\b/.test(intent)
    || !/\b(nep|house|gaa)\b/.test(intent) && !options.stage);
  const moneyRequest = /\b(magkano|how much|budget|budgets|badyet|pondo|halaga|halagang|amount|amounts)\b/.test(intent);
  const summaryRequest = /\b(buod|ibuod|summary|overview|summarize|summarise|pangkalahatan)\b/.test(intent);
  const cityOverview = /\bantipolo\b/.test(intent) && (summaryRequest || moneyRequest || countRequest);
  const comparison = /\b(compare|comparison|versus|vs|difference|ihambing|pagkakaiba|pinagkaiba)\b/.test(intent);
  const limitation = /\b(tapos|natapos|completion|completed|complete|finished|nagastos|ginastos|spent|spending|contractor|kontratista|procurement|disbursement|corruption|corrupt|anomalya|irregularity)\b/.test(intent);
  const dashboardSummary = !highest && !comparison && !limitation && intent !== 'pondo' && (!request.context?.projectKey || cityOverview) && !options.projectKey
    && !named.length && !exactKeys.length && (countQuestion || summaryRequest || moneyRequest && (!definition || /\bantipolo\b/.test(intent)));
  const countOnly = dashboardSummary && countRequest && !moneyRequest;
  const numeric = highest || /\b(magkano|halaga|halagang|amount|how much|total|totals|kabuuan|kabuuang|sum|ilan|ilang|how many|count|difference|compare|ihambing|pagkakaiba|pinagkaiba)\b/.test(intent);
  const aggregate = dashboardSummary || (!highest && /\b(total|totals|kabuuan|kabuuang|sum|lahat|all|ilan|ilang|how many|count)\b/.test(intent));
  const plural = highest || aggregate || /\b(mga|projects|records|list|show|find|any|may|mayroon|meron|barangay|brgy)\b/.test(intent);
  const glossaryEntries = data.glossary.filter((g) => g.aliases.some((alias) => phrase(q, alias)));
  let definitionRemainder = q;
  for (const entry of glossaryEntries) for (const alias of [...entry.aliases].sort((a, b) => b.length - a.length)) {
    definitionRemainder = ` ${definitionRemainder} `.replaceAll(` ${normalize(alias)} `, ' ').trim();
  }
  if (!dashboardSummary && (definition || glossaryEntries.some((g) => g.aliases.some((alias) => normalize(alias) === q)))
    && !/\b(magkano|halaga|halagang|amount|how much|total|totals|kabuuan|kabuuang|sum|ilan|ilang|count)\b/.test(q)
    && !words(definitionRemainder).length && !exactKeys.length && !named.length && !options.projectKey && !Object.keys(options).length) {
    if (glossaryEntries.length) return finish('reference', glossaryEntries.slice(0, 6).map((g) => addGlossary(g.id)).join('\n\n'));
  }
  let query = highest ? intent.replace(highestPattern, ' ') : intent;
  const queryYears = [...new Set(query.match(/\b(?:19|20|21)\d{2}\b/g) ?? [])].map(Number);
  if (queryYears.length > 1) return clarify('Pumili po tayo ng isang taon upang malinaw ang halaga ng budget na titingnan.', 'Please choose one fiscal year; amounts are kept separate by year.');
  if (options.year !== undefined && (!Number.isSafeInteger(options.year) || (queryYears.length && options.year !== queryYears[0]))) {
    return clarify('Magkaiba po ang napiling taon at ang taon sa inyong tanong. Aling taon po ang nais ninyong tingnan?', 'The selected year differs from your question. Which year would you like to check?');
  }
  filter.year = options.year ?? queryYears[0] ?? (dashboardSummary && !/\b(gaa|enacted|batas na budget)\b/.test(query) && options.stage !== 'gaa' ? 2027 : null);
  if (filter.year !== null && ![2027, ...GAA_YEARS].includes(filter.year)) return noData();
  let stages = stageAliases.filter(([, aliases]) => aliases.some((alias) => phrase(query, alias))).map(([stage]) => stage);
  if (stages.includes('hgab2') || stages.includes('hgab3')) stages = stages.filter((stage) => stage !== 'house');
  if (options.stage !== undefined) {
    if (!stageAliases.some(([stage]) => stage === options.stage) || (stages.length && !stages.includes(options.stage))) {
      return clarify('Aling budget po ang nais ninyong tingnan: panukala ng Pangulo (NEP), panukala ng Kamara (House bill), o nakapasa nang budget (GAA)?', 'Which budget would you like to check: the President’s proposal (NEP), the House proposal (House bill), or the enacted budget (GAA)?');
    }
    stages = [options.stage];
  }
  filter.stages = stages;
  if (filter.year === null && stages.some((stage) => stage !== 'gaa')) filter.year = 2027;
  if (dashboardSummary && filter.year === null && stages.includes('gaa')) return clarify('Anong taon po ang nais ninyong tingnan? May nakapasang budget para sa 2020 hanggang 2026. Pumili po tayo ng isa.',
    'Which year would you like to check? Enacted budgets are available for 2020 through 2026. Please choose one.');
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
    if (typeof options.program !== 'string' || !programs.has(normalize(options.program))) return clarify('Aling programa o ahensiya po ang nais ninyong tingnan? Maaari po ninyong ibigay ang pangalan nito.', 'Which program or agency would you like to check? Please share its name.');
    const selected = normalize(options.program);
    if (programNames.some((name) => name !== selected && !phrase(name, selected) && !phrase(selected, name)
      && !(programs.get(name)!.size === programs.get(selected)!.size && [...programs.get(name)!].every((key) => programs.get(selected)!.has(key))))) {
      return clarify('Magkaiba po ang napiling programa at ang nasa inyong tanong. Alin po ang nais ninyong tingnan?', 'The selected program differs from your question. Which would you like to check?');
    }
    filter.program = selected;
  } else if (programNames.length > 1) return clarify('Pumili po muna tayo ng isang programa o ahensiya.', 'Please choose one program or agency.');
  else filter.program = programNames[0] ?? null;
  for (const name of programNames) query = ` ${query} `.replaceAll(` ${name} `, ' ').trim();

  // ponytail: explicit city phrases + common city names, not a geography parser; add reviewed aliases after observed misses.
  const otherCity = /\b(?:city of|lungsod ng) (?!antipolo\b)[\p{L}]+|\b(?!antipolo\b)[\p{L}]+ city\b/gu;
  const cityMentions = [...q.matchAll(otherCity)].filter((m) => m[0] !== 'city budget' && m[0] !== 'whole city');
  if (!exactKeys.length && !all.some((r) => phrase(q, r.title))
    && (cityMentions.length || /\b(?:budget (?:ng|of)|sa|in) (?:manila|cebu|davao|quezon|pasig|marikina|lipa|batangas)\b/.test(q))) {
    return finish('reference', addGlossary('glossary:antipolo-coverage'));
  }
  if (!named.length && /\b(city hall|munisipyo|lokal na pamahalaan)\b/.test(intent)) return finish('reference', say('Ang laman ng portal ay mga pambansang proyekto sa Antipolo. Wala rito ang buong budget ng City Hall. Para roon, kailangan ang hiwalay na budget ng pamahalaang lungsod.',
    'This portal lists national projects in Antipolo. It does not contain the complete City Hall budget, which needs the city government’s separate budget records.'));
  if (highest) {
    if (/\b(lugar|barangay|barangays|baranggay|baranggays|area|areas|district|districts|neighbourhood|neighborhood)\b/.test(intent)) {
      return clarify('Walang kumpletong paghahati ng budget bawat lugar o barangay sa mga talang ito. Maaari kong hanapin ang proyektong may pinakamataas na nakalistang halaga. Anong taon at bersiyon: NEP, House bill, o GAA? Halimbawa: “Anong proyekto ang may pinakamataas na budget sa Antipolo sa 2027 House?”',
        'These records do not provide complete budget totals by area or barangay. I can find the project with the highest listed amount instead. Which year and version: NEP, House bill, or GAA? For example: “Which project has the highest budget in Antipolo in 2027 House?”');
    }
    if (filter.year === null || stages.length !== 1) return clarify('Para mahanap ang pinakamataas na halaga, pumili ng isang taon at isang bersiyon: NEP o House bill para sa 2027, o GAA para sa 2020–2026. Halimbawa: “Pinakamataas na budget na proyekto sa Antipolo 2027 House”.',
      'To find the highest amount, choose one year and one version: NEP or House bill for 2027, or GAA for 2020–2026. For example: “Highest budget project in Antipolo 2027 House”.');
    if (options.projectKey || exactKeys.length || named.length) return clarify('Nais po ba ninyong hanapin ang pinakamataas na budget sa lahat ng katugmang proyekto, o ang halaga lamang ng napiling proyekto? Para po maihambing ang mga proyekto, pakibigay ang taon at kung panukala ng Pangulo (NEP), Kamara (House bill), o nakapasa nang budget (GAA) ang titingnan.',
      'Would you like the highest budget across matching projects, or only the selected project’s amount? To compare projects, please share the year and whether to check the President’s proposal (NEP), House proposal (House bill), or enacted budget (GAA).');
  }
  const tokens = words(query);
  filter.keywords = tokens;
  let selected: string | undefined = options.projectKey ?? exactKeys[0]?.key;
  if (options.projectKey && named.length && !named.some((r) => r.key === options.projectKey)) return clarify('Magkaiba po ang napiling proyekto at ang nasa inyong tanong. Alin po ang nais ninyong tingnan?', 'The selected project differs from your question. Which would you like to check?');
  if (!selected && named.length === 1) selected = named[0].key;
  if (!selected && !tokens.length && !plural) selected = request.context?.projectKey;
  if (selected) filter.projectKey = selected;
  if (selected && exactKeys.length && selected !== exactKeys[0].key) return clarify('Magkaiba po ang mga napiling proyekto. Maaari po ninyong ibigay ang pangalan ng nais ninyong tingnan?', 'Different projects were selected. Please share the name of the project you would like to check.');
  refreshProjects = filter.year === 2027 && !selected && !limitation;

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
    return clarify('Aling proyekto, programa, o taon po ang nais ninyong tingnan? Para sa halaga, pakisabi rin po kung panukala ng Pangulo (NEP), panukala ng Kamara (House bill), o nakapasa nang budget (GAA). Hindi po ito ang buong budget ng City Hall.',
      'Which project, program, or fiscal year do you mean? For an amount, also choose NEP, House bill, or GAA. These records are not the complete City Hall budget.');
  }
  if (!candidates.length && !(countOnly && filter.year === 2027)) return noData();
  const rank = (r: (typeof all)[number]) => {
    const title = words(r.title);
    return Number(phrase(normalize(r.title), query)) * 100 + Number(phrase(title.join(' '), tokens.join(' '))) * 20
      + tokens.reduce((score, token) => score + (title.includes(token) ? 3 : 1), 0);
  };
  candidates.sort((a, b) => rank(b) - rank(a) || a.key.localeCompare(b.key));
  matched = candidates;
  const years = new Set(candidates.map((r) => r.kind === 'project' ? '2027' : '2020–2026'));
  if ((!selected && years.size > 1) || (aggregate && filter.year === null && candidates.some((r) => r.kind === 'gaa'))) {
    return clarify('Anong taon po ang nais ninyong tingnan? May panukala ng Pangulo at Kamara para sa 2027 at nakapasa nang budget para sa 2020–2026. Magkakahiwalay po ang halaga bawat taon.',
      'Which fiscal year? NEP/House covers 2027 and GAA covers 2020–2026. Years are not added together.');
  }
  if (!selected && !plural && candidates.length > 1) {
    for (const r of candidates.slice(0, 6)) addRecord(r);
    return clarify('May ilang proyektong tugma sa inyong tanong. Alin po sa mga proyektong nasa ibaba ang nais ninyong tingnan? Maaari po ninyong ibigay ang pangalan o barangay.', 'Several projects match your question. Which of the projects below would you like to check? Please share its name or barangay.');
  }
  if (highest && !limitation) {
    const stage = stages[0];
    const listedAmount = (r: (typeof all)[number]) => r.kind === 'gaa'
      ? (r.record.years[filter.year!].amount || null)
      : stage === 'gaa' ? null : stage === 'house' ? r.record.house_php : r.record[`${stage}_php`];
    const maximum = candidates.reduce((max, r) => Math.max(max, listedAmount(r) ?? -1), -1);
    if (maximum < 0) return finish('no_data', say('Walang sapat na nakalistang halaga para matukoy ang pinakamataas sa piniling taon at bersiyon.',
      'There are not enough listed amounts to determine the highest for the selected year and version.'));
    // Compare the complete matching set, not only the first six relevance matches. Keep ties.
    candidates = candidates.filter((r) => listedAmount(r) === maximum);
  }

  function querySources(dataset?: string): string[] {
    return projectData.queries.filter((query) => !dataset || query.dataset === dataset).map((query) => addSource({
      id: `source:query:${query.dataset}`, title: `${query.dataset.toUpperCase()} — ${say('mga proyekto sa Antipolo', 'Antipolo projects')} (2027)`, url: query.api,
    }));
  }
  function recordSources(r: (typeof all)[number]): string[] {
    if (dashboardSummary && r.kind === 'project') return querySources(r.record.dataset);
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
  const perRecordSources = new Map(matched.map((r) => [r.key, recordSources(r)]));
  const caution = candidates.some((r) => r.kind === 'project' && (r.record.held || ['house_only', 'nep_only', 'scope_review'].includes(r.record.bridge_group)));
  const evidenceLimit = 6 - Number(limitation) - Number(caution);
  for (const r of candidates.slice(0, evidenceLimit)) addRecord(r);
  const factPrefix = `fact:${digest([snapshotId, filter, candidates.map((r) => r.key)])}`;
  const stageName = (stage: Fact['stage']) => stage === 'nep' ? say('Panukala ng Pangulo (NEP)', 'President’s proposal (NEP)')
    : stage === 'house' ? say('Panukala ng Kamara (House bill)', 'House proposal (House bill)')
      : stage === 'gaa' ? say('Nakapasa nang batas (GAA)', 'Enacted budget (GAA)') : stage.toUpperCase();
  const addFact = (fact: Omit<Fact, 'id'>) => {
    if (countOnly && fact.kind !== 'count') return;
    if (dashboardSummary && !countOnly && fact.kind === 'count' && fact.stage !== 'all') return;
    assert.ok(fact.value === null || Number.isSafeInteger(fact.value), 'Unsafe financial total');
    const label = dashboardSummary && fact.stage !== 'all' ? `${stageName(fact.stage)}${fact.kind === 'count' ? fact.unit === 'families'
      ? say(' — mga grupong may pondo', ' — funded program families') : say(' — mga proyektong may halaga', ' — projects with a listed amount') : ''}` : fact.label;
    facts.push({ ...fact, label, id: `${factPrefix}:${fact.recordKey ?? 'aggregate'}:${fact.year}:${fact.stage}:${fact.kind}` });
  };
  const idsFor = (rows: { key: string }[]) => [...new Set(rows.flatMap((r) => perRecordSources.get(r.key)!))];
  const projectRows = candidates.filter((r) => r.kind === 'project').map((r) => r.record);
  const gaaRows = candidates.filter((r) => r.kind === 'gaa').map((r) => r.record);
  if (dashboardSummary && (countRequest || summaryRequest) && filter.year === 2027 && !stages.length) addFact({ kind: 'count', label: tokens.length ? say('Mga proyektong tumutugma sa tanong', 'Projects matching your question') : say('Kabuuang proyekto', 'Total projects'),
    value: projectRows.length, unit: 'records', year: 2027, stage: 'all', sourceIds: querySources(), availableCount: projectRows.length, missingCount: 0 });
  const batches = countOnly && filter.year === 2027 && !stages.length ? [] : aggregate ? [{ projects: projectRows, gaa: gaaRows, recordKey: undefined }]
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
  if (dashboardSummary) {
    const lines = facts.filter((fact) => countOnly ? fact.kind === 'count' : fact.kind === 'amount' || fact.stage === 'all').map((fact) =>
      `${fact.label}: ${fact.value === null ? say('hindi nakalista', 'not listed') : fact.unit === 'PHP' ? phpFull(fact.value) : fact.value.toLocaleString('en-PH')}${fact.kind === 'count' ? fact.unit === 'families' ? say(' grupo ng programa', ' program families') : say(' proyekto', ' projects') : ''}.`);
    const year = filter.year ?? '';
    if (countOnly && filter.year === 2027 && !stages.length) return finish('reference', say(
      `May ${projectRows.length.toLocaleString('en-PH')} proyektong ${tokens.length ? 'tumutugma sa inyong tanong sa mga tala' : 'nakalista'} para sa Antipolo sa 2027. Mga pambansang proyekto po ito na kasama sa portal, hindi lahat ng proyekto o ang buong budget ng City Hall.`,
      `There are ${projectRows.length.toLocaleString('en-PH')} ${tokens.length ? 'projects matching your question in the records' : 'listed projects'} for Antipolo in 2027. These are national projects covered by this portal, not every project or the complete City Hall budget.`));
    const intro = summaryRequest ? say(`Narito ang buod batay sa mga tala para sa ${year}:`, `Here is a summary based on the available ${year} records:`)
      : say(`Para sa ${year} na mga proyekto sa portal:`, `For the ${year} projects in this portal:`);
    return finish('reference', `${intro}\n\n${lines.join('\n')}\n\n${say('Mga pambansang proyektong nakalista para sa Antipolo ito, hindi ang buong budget ng City Hall.', 'These are national projects listed for Antipolo, not the complete City Hall budget.')}${countOnly ? '' : say(' Magkaibang panukala ang NEP at House bill—hindi sila pinagsasama. Ang nakalaang halaga ay hindi ibig sabihing nagastos na.', ' NEP and House are separate proposals, never added together. A listed budget does not mean the money has been spent.')}`);
  }
  const answer = limitation ? addGlossary('glossary:appropriation-not-spending') : highest ? say('Narito ang mga talang may pinakamataas na nakalistang halaga sa piniling taon at bersiyon. Kasama ang magkakapantay na halaga; hanggang anim na tala ang maipapakita. Hindi kasama sa pagraranggo ang mga walang nakalistang halaga o GAA na walang pondong inilaan. Hindi ito pagraranggo ng kabuuang budget bawat barangay.',
    'These records have the highest listed amount for the selected year and version. Ties are retained; up to six records can be shown. Missing amounts and unfunded GAA entries are excluded from ranking. This is not a ranking of total budgets by barangay.') : say('Narito ang mga katugmang tala at ang halaga sa bawat taon at bersiyon. Ang nawawalang halaga ay hindi zero.',
    'Here are the matching records and their amounts by fiscal year and version. A missing amount is not zero.');
  const review = caution ? `\n\n${addGlossary('glossary:comparison-candidates')}` : '';
  const titles = highest && !limitation ? `\n\n${candidates.slice(0, evidenceLimit).map((r) => `• ${r.title}`).join('\n')}` : '';
  return finish('reference', `${answer}${titles}${review}\n\n${coverage[lang]}`, !limitation && /\b(explain|ipaliwanag|paliwanag|simpleng|simpler)\b/.test(q));
}
