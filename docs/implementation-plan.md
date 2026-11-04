# Antipolo Budget Assistant — implementation plan

Status: Phases 1–5 repository implementation complete, with a reviewed public-data
snapshot, offline retrieval/reference responses, a bounded Vercel/Gemini API, and an
accessible bilingual chat UI with offline browser checks, plus refresh-gated Vercel
builds and a deployment/usage runbook. Phase 6's offline evaluation and pilot-review
protocol are implemented; real-generation/native-speaker review and reader sessions
remain pending. Phase 5's account configuration, actual quotas,
and live Vercel/WAF verification remain pending. Phase 4's manual
screen-reader/readability review remains pending.
Phase 3's protected-preview/real-provider exit check remains pending. Phase 0
repository setup is implemented; account verification and its live smoke check
remain pending. Unchecked tasks remain incomplete.

Date: 2026-11-02.

Requirements: [RAG chatbot specification](rag-chatbot-spec.md).

## Delivery goal

Deliver a working, low-budget assistant on Vercel that explains Antipolo budget
records in simple Filipino, supports English, and shows verifiable sources. Start
with keyword-based RAG and Gemini's verified free tier. Use existing TypeScript
utilities, native `fetch()`, and the installed tooling before adding dependencies.

The first milestone is a private, end-to-end demonstration: select an Antipolo
project, ask for an explanation, and receive a sourced Filipino answer from Gemini.
Public release follows accuracy, accessibility, and quota-fallback testing.

## Current repository baseline

- React/Vite frontend, offline retrieval, and `POST /api/chat` as a Vercel Function.
- `portal.config.ts` defines the Antipolo City place scope without whole-office
  queries or district cards.
- `src/api/client.ts` already handles Budget API pagination.
- `src/lib/scope.ts` resolves scoped 2027 records and summaries.
- `src/lib/gaa.ts` resolves enacted-budget families and per-year totals.
- `src/pages/Project.tsx` checks project membership before loading details.
- `vercel.json` checks files/Functions first, returns 404 for unknown API paths,
  then serves the SPA fallback. Live Vercel routing verification remains pending.
- `tsconfig.node.json` covers scripts, tests, server helpers, Functions, and Vite
  configuration.

Existing user changes should be preserved. This plan does not require changing the
application framework or replacing the Budget API client.

## Phase 0 — Confirm the free-tier setup

Can run alongside the data/retrieval work; it blocks only real AI testing.

Setup instructions and the dated verification record: [Phase 0 setup](ai-setup.md).
`npm run chat:check` validates local configuration without network access;
`npm run test:chat-setup` checks the probe with mocked responses. After verifying
the account's free setup, `npm run chat:check -- --live` performs one server-side
generation. No real-provider request has been made yet.

- [x] Add disabled-by-default server-only environment examples, ignored local secret
  files, and an explicit one-request CLI smoke check with credential-free tests.
- [x] Record current published Vercel Hobby allowances, protected-preview setup,
  verification blockers, and a draft bilingual privacy notice in `docs/ai-setup.md`.

- [ ] Verify that the intended deployment qualifies for Vercel Hobby, or record
  the actual hosting plan and its limits.
- [ ] Create/select a Google AI Studio project and a dedicated Gemini API key.
- [ ] Confirm an available free-tier text model and record its exact model ID,
  account RPM/TPM/daily restrictions, supported output format/settings, and date
  checked. Do not assume an allowance from a blog or an old model name.
- [ ] Review current Gemini data-use terms and document the short user-facing
  privacy notice.
- [ ] Store `GEMINI_API_KEY`, `GEMINI_MODEL`, and `CHAT_ENABLED` as server-only
  configuration. Start on a protected Vercel preview.
- [ ] Confirm the selected project/model is using the intended free setup; do not
  automatically enable billing or use a paid fallback.

**Exit:** model and hosting eligibility are documented; one minimal server-side
generation can be tested without exposing a key. Other implementation work must
remain testable without a real key.

## Phase 1 — Build the evidence snapshot

**Depends on:** the existing portal scope, not Gemini.

Files: `scripts/build-rag.ts`, `data/rag/antipolo.json`, and `package.json`.

- [x] Add `npm run rag:build` using `resolveScope()` and `resolveGaa()`.
- [x] Verify the declared Antipolo scope before collecting records; fail if a
  configuration change broadens it unexpectedly.
- [x] Preserve stable project/family IDs, amounts, missing values, fiscal years,
  budget stages, exclusions, published labels, and available citations.
- [x] Add a small reviewed glossary, including NEP, House bill, GAA, appropriation
  versus spending, and provisional comparison statuses. Keep definitions in a
  maintained source file rather than asking Gemini to invent them.
- [x] Generate a manifest with schema version, snapshot ID, scope fingerprint,
  collection/source dates, counts, and query completeness.
- [x] Reject failed required requests, truncated lists, duplicate/conflicting IDs,
  or malformed records. Replace the final artifact only after full validation.
- [x] Include one reviewed public-data snapshot so a normal clean-checkout build
  works without network access or Gemini. A refresh updates this artifact; never
  commit credentials or conversations with it.

**Checks:** assert scope/exclusion preservation and round-trip amounts on small
fixtures. Exercise a failed/truncated collection and verify that it cannot replace
the last good artifact. Reconcile live per-year totals using the existing check.

**Exit:** a complete, versioned snapshot can be regenerated and its sources traced.
Record counts are diagnostic output, not fixed assertions: upstream data can change.

### Phase 1 usage and review — 2026-11-01

- `npm run rag:build` refreshes `data/rag/antipolo.json` from the public Budget
  API. It does not load Gemini credentials. `npm run build` remains an offline
  frontend build and does not trigger a refresh.
- `npm run test:rag` uses Node's built-in test/assert modules and mocked `fetch`.
  It checks scope before any request, pagination, duplicate/conflicting IDs,
  malformed records, excluded records, null/zero preservation, exact round-trip
  amounts, deterministic content IDs, and retention of the last good file on
  failed or truncated collection. It also checks the bundled artifact offline.
- Schema 1 contains `manifest`, `reference`, `projects`, `gaa`, and `glossary`.
  Rows inherit the manifest's portal scope and fiscal-year/stage context. Original
  IDs, per-version/year amounts, published labels, provisional flags, notices,
  PDF links/pages, and manual exclusion records are preserved.
- `manifest.queryCompleteness.queries` records every required search, including
  GAA departments with zero matches. Its fetched counts are before region/manual
  exclusions; `projects.queries` records the region-kept counts. The source commit
  and build date are separate from `collectedAt`; GAA's missing source commit/date
  are explicitly `null`. Collection time is excluded from the content hash.
- GAA citations join a family's `department_id` and `reasons` to `gaa.queries`,
  retaining its `fam_key`, agency and year. No PDF page is manufactured. The
  department directory retains identifiers/labels, not nationwide budget totals.
- Review found three Lipa City, Batangas namesakes in the word-based 2027 search.
  Their IDs and reasons were added to the existing `portal.config.ts` exclusions,
  so the live portal and snapshot apply the same rule. A title review found no
  corresponding GAA namesakes. The provisional match, NEP-only FMR record, null
  PDF references, and GAA zero-amount carry-forward years were spot-checked.
- Reviewed collection: **85 FY2027 projects, 506 GAA families, seven bilingual
  glossary entries, three manual exclusions, one region omission, 38 departments,
  42 complete searches**. These are observations, not fixed test expectations.
  FY2027 totals are **₱1,961,000,000 NEP** and **₱2,197,000,000 House**, kept separate.
  `npm run check` reconciles the live GAA queries across all 21 matching
  department/year combinations.
- Verification passed: all 28 `test:rag` checks, `npm run build`, `npm run lint`,
  `npm run check` (including the 21 live reconciliations), and the existing
  Playwright project-scope check.

Refresh the snapshot after editing the reviewed glossary or scope/exclusions.
The collector validates everything before writing a temporary sibling file and
renaming it over the final artifact. A failed refresh exits nonzero and leaves the
last good artifact available.

## Phase 2 — Implement deterministic retrieval and facts

**Depends on:** Phase 1.

Files: `server/rag.ts`, a reviewed glossary source, and focused test fixtures.
Keep retrieval and financial computation in a small shared server module initially.

- [x] Load the bundled snapshot and validate its schema/scope once per instance.
- [x] Implement normalized phrase/keyword ranking and the small Filipino–English
  synonym list described in the specification.
- [x] Verify selected-project IDs against snapshot membership.
- [x] Apply explicit year/program/project filters before ranking; reject or
  clarify ambiguous filters instead of guessing.
- [x] Return at most six explanation records with their allowed source IDs.
- [x] Build financial fact cards in TypeScript, reusing `summarise()` and
  `gaaYearTotals()` where their semantics apply.
- [x] Compute aggregates from the complete matching set, then select representative
  explanation evidence. Preserve the aggregate's filter, count, and provenance.
- [x] Implement reviewed glossary, clarification, out-of-scope, and no-data
  responses that do not call Gemini.

**Checks:** exact project lookup, Taglish synonyms, ambiguous names, forged IDs,
null versus zero, GAA zero-year handling, and an aggregate with more than six
matching records. Verify NEP and House amounts are never added together.

**Exit:** retrieval and reference responses work with no AI service configured.

### Phase 2 usage and review — 2026-11-01

`server/rag.ts` exports `retrieve()` and the cached `loadSnapshot()`. Loading uses
the collector's shared `validateSnapshot()` to check schema, declared scope and
exclusions, completeness, sources, integer amounts, and content hash. A damaged or
incompatible artifact fails before retrieval. These helpers need no Gemini key.

```ts
import { retrieve } from './server/rag.ts';

const explanation = await retrieve({
  message: 'Ipaliwanag ang proyektong ito.',
  context: { projectKey: 'dpwh:house-reading:4279' },
});
const total = await retrieve({
  message: 'Kabuuang halaga ng mga kalsada sa Mayamot',
  filters: { year: 2027, stage: 'nep', program: 'dpwh' },
});
```

- `language` defaults to `fil` and also accepts `en`. Optional `filters` accept
  `year`, `stage`, `program`, and `projectKey`. Stages are `nep`, `house`, `hgab2`,
  `hgab3`, `api`, and `gaa`. Program selectors use snapshot dataset/program labels,
  department names/IDs/abbreviations, and agency IDs. An agency filter is not an
  inferred GAA classification for an entire program such as FMR or HFEP.
- Known IDs and full names take precedence over keyword matches. Context IDs must
  be snapshot members even if the current question overrides them. Obsolete,
  excluded, or forged IDs do not fall back to similarly named projects. Explicit
  project names override old selected-project context; conflicting explicit filters
  ask for clarification.
- Normalization handles accents, case, punctuation, whitespace, and `FY2027`.
  Reviewed synonym groups cover roads/kalsada/daan, bridges/tulay,
  hospitals/ospital, schools/paaralan/eskwelahan, flood/baha,
  irrigation/irigasyon, and health/kalusugan. Meaningful keywords must all match;
  phrases and title matches rank ahead of metadata matches. Generic words such as
  `pondo` do not select projects. City recognition and keyword matching are small
  deterministic rules; expand reviewed aliases when evaluation demonstrates misses.
- Responses contain reference text, typed facts, trusted sources, at most six
  coherent evidence records (including any reviewed glossary notes), allowed IDs,
  and current snapshot identity/date/freshness. `needsExplanation` identifies a
  project explanation that Phase 3 may enrich; the reference result already works.
- Aggregate provenance retains the effective filter, all matching record keys,
  count, snapshot, and source references. Totals use the complete set before
  selecting explanation records. NEP/House and fiscal years stay separate;
  missing amounts retain missing counts and remain `null` when none are listed.
  GAA carry-forward zeroes are not funded families. Unsafe integer totals fail
  rather than silently rounding pesos. Differences are withheld for missing,
  unconfirmed, or scope-incomparable records.
- Ambiguous singular names, conflicting filters, unspecified aggregate years, and
  monetary requests without a resolvable version clarify. Definitions, city-scope
  explanations, and unsupported spending/completion claims use reviewed bilingual
  glossary text. Unsupported years and absent records return `no_data`. Multi-year
  aggregation asks for one fiscal year; an individual GAA family can display all
  seven years as separate facts.

Verification: **36 `npm run test:rag` checks**, `npm run build`, and `npm run lint`
passed. The new checks exercise real-snapshot totals and isolated offline fixtures
for IDs, context overrides, Taglish, ambiguity, program/year/version filters, more
than six aggregate matches, partial/null/zero amounts, provisional differences,
GAA carry-forwards, trusted citations, deterministic fact IDs, arithmetic overflow,
bilingual reference responses, freshness, and damaged snapshots. No provider call
or live snapshot refresh is needed for these checks.

## Phase 3 — Add the Vercel API and one Gemini call

**Depends on:** Phase 2; Phase 0 for a real-provider smoke check.

Files: `api/chat.ts`, `server/chat.ts`, `src/api/chat-types.ts`, `.env.example`,
TypeScript configuration, and `vercel.json`.

- [x] Define shared request/response types without importing server code or secrets
  into the frontend. Use the modes and limits in specification section 9.
- [x] Implement bounded body parsing, JSON/type checks, language validation,
  context membership checks, and method handling at `POST /api/chat`.
- [x] Keep server helpers outside `api/` so Vercel does not create unintended
  separate Functions for utility files.
- [x] Use native `fetch()` for Gemini. Set the model from server configuration,
  select supported structured-output settings, and apply the 20-second timeout.
- [x] Build a prompt with clear source boundaries: evidence is data, scope is
  Antipolo, no invented facts, and amounts come from the supplied facts.
- [x] Make at most one generation request. Require explanation text and allowed
  citation/fact IDs; resolve links and figures server-side.
- [x] Validate the response. Fall back to reference results on bad output, missing
  configuration, provider errors, timeout, quota exhaustion, or disabled AI.
- [x] Add `Cache-Control: no-store` and operational logging without raw prompts,
  questions, secrets, or provider error bodies.
- [x] Include server/Function files in type checking. Configure JSON imports/file
  inclusion so the snapshot is present in a deployed Function bundle.
- [x] Adjust Vercel routing so API requests reach the Function before SPA fallback.
  Unknown API paths must not masquerade as successful chat responses.

**Checks:** mock Gemini for success, malformed output, unknown citation IDs,
quota `429`, timeout, and error responses. Verify invalid input and reference-only
questions make no provider call. Inspect the client build for accidental secrets.

**Exit:** the endpoint returns a real sourced Filipino explanation on a protected
preview, and useful reference responses when AI is unavailable.

### Phase 3 usage and review — 2026-11-01

- `api/chat.ts` uses Vercel's supported Web-standard `fetch` export and native
  `Request`/`Response`; no SDK, server framework, or new dependency was added.
  It reads at most 8 KB before JSON parsing, including chunked/incorrect-length
  requests, and validates question length, language, filters, and context/history
  shapes. Unknown fields cannot supply records, amounts, or URLs. Project membership
  is checked by the shared retriever; forged/obsolete/excluded keys return no-data.
- `src/api/chat-types.ts` owns the public transport types; the retriever reuses
  them. Optional `context.snapshotId` is advisory: the response always reports the
  current server snapshot. Optional `history` is at most two `{ user, assistant }`
  exchanges, each field at most 500 characters. Deictic follow-ups can re-retrieve
  a previous user question identifying one project; assistant text never supplies
  evidence. Explicit current questions retain precedence.
- `server/chat.ts` generates only when retrieval marks a supported explanation as
  needing it. Reviewed definitions, direct figures, clarification, limitations and
  no-data remain provider-free. Enabled AI uses the exact configured model with
  `systemInstruction`, JSON `responseSchema`, temperature zero, at most 600 output
  tokens, a 20-second deadline, and no retries or alternate model. Account/model
  compatibility, including reasoning overhead, still requires Phase 0 verification.
- The entire serialized provider body is capped at 12,000 characters. Oversized
  evidence is reduced by whole ranked records with their facts; reviewed cautions
  remain. Aggregate amounts/counts are calculated beforehand from the full set,
  and full source/filter/record provenance remains in the API response. If even
  one coherent record cannot fit, the endpoint returns reference information.
- Generated JSON must have nonempty plain text, known citation/fact IDs, and a
  cited source for each selected fact. Bad/truncated/blocked output, HTML/URLs,
  and prose figures outside exact official titles fall back. Financial values and
  links always come from retrieval. These structural checks do not establish
  factual entailment; Phase 6's reviewed claim evaluation is still required.
- Responses include `citationIds`/`factIds`, all server facts/sources, snapshot
  freshness and provenance. AI fallback sets `aiUnavailable: true` and includes a
  localized availability notice. Missing evidence returns a friendly 503. Errors
  and successes use `no-store`; method errors include `Allow: POST`. Same-origin
  checks reject cross-site browser requests, without claiming authentication or
  distributed quota enforcement. Logs contain only latency, mode, fixed category,
  validated model/snapshot IDs, and allowlisted numeric provider token usage.
- Vercel explicitly includes `data/rag/antipolo.json` in the Function and permits
  30 seconds for the 20-second upstream timeout plus fallback. Files/Functions are
  routed before an API-only 404 and the SPA fallback. There is only one file in
  `api/`. Full-stack local/preview verification is described in [deployment](deploy.md).

Verification passed: **38 `npm run test:chat` checks**, all 36 `test:rag` checks,
`test:chat-setup`, `npm run build`, `npm run lint`, `npm run check` (21 live GAA
reconciliations), and the Playwright project-scope check. Mocked cases cover success,
quota/errors, deadline, malformed/unknown IDs, disabled/missing configuration,
bounded UTF-8/chunked bodies, history, full-set aggregates, private logs, and missing
evidence. A build with fake server-only Gemini canaries was inspected for leaks.
No actual Gemini generation or Vercel deployment was performed.

- [ ] Complete Phase 0 account/model/settings verification and the explicit live probe.
- [ ] On a protected Vercel preview, verify a sourced Filipino AI answer, disabled-AI
  reference answer, Function snapshot loading, API method handling, unknown-API 404,
  and ordinary SPA navigation. The static routing checks do not replace this exit check.

## Phase 4 — Add the accessible chat experience

**Depends on:** Phase 3; UI work can use mocked API responses earlier.

Files: `src/components/ChatPanel.tsx`, its application entry point,
`src/pages/Project.tsx`, and `src/styles/app.css`.

- [x] Add the labeled “Magtanong tungkol sa budget” entry point and suggested
  questions. Do not open it automatically.
- [x] Add “Ipaliwanag ang proyektong ito” to supported project pages, sending only
  the project key as context.
- [x] Default to Filipino; support an explicit English switch.
- [x] Render explanation text, deterministic facts, trusted sources, response mode,
  snapshot date, and freshness notice.
- [x] Add waiting, clarification, no-data, provider-unavailable, and network-error
  states. Handle non-JSON WAF responses without showing technical errors.
- [x] Prevent duplicate in-flight submissions; provide bounded follow-up context,
  “Mas simpleng paliwanag,” and “Bagong usapan.”
- [x] Keep history in memory only. Display the AI/provider privacy notice.
- [x] Implement keyboard/focus behavior, screen-reader announcements, readable text,
  sufficiently large controls, mobile reflow, and zoom support.

**Checks:** use the installed Playwright tooling for the main user journey,
selected-project context, language switching, fallback, keyboard interaction, and
mobile layout. Manually check screen-reader announcements and readability.

**Exit:** a reader can ask about a project, understand the response, and open its
source using a phone or keyboard. Ordinary portal browsing still works without AI.

### Phase 4 usage and review — 2026-11-02

- The application entry opens `src/components/ChatPanel.tsx` only on request.
  In-scope project details open the same panel with a prepared explanation question;
  the reader can review the privacy notice and press Send. Context contains only
  `projectKey`, never browser-supplied project records, amounts, or URLs. A project
  missing from the server snapshot receives the endpoint's no-data response.
- A native modal `dialog` supplies background inertness, keyboard behavior, Escape,
  and return-to-opener focus. It opens at its close control so the introduction and
  privacy notice are encountered before the form. Answers do not move focus. A
  polite status announces waiting/completion; friendly errors use an alert.
- Filipino is the initial language; English changes controls and subsequent answers
  while previous exchanges retain their own language. Suggested questions prepare
  the input. “Mas simpleng paliwanag” retains a resolved project or the last question.
  “Bagong usapan” clears messages/context and cancels any pending request. Closing
  also cancels pending work; a late response cannot restore discarded conversation.
- Conversation state lives only in React memory. The API receives at most two
  exchanges, each user/assistant field capped at 500 characters; older history is
  dropped if multibyte text would exceed 8 KB. Duplicate submissions are guarded
  synchronously. There are no automatic retries; the client bounds waiting to 30
  seconds and handles HTML WAF/SPA responses, 429, 503, invalid JSON/shapes, and
  network failures with localized messages and an explicit retry button.
- Answers show escaped plain text, response mode, provider availability, exact peso
  values with compact formatting, separate fiscal years/stages, missing versus zero,
  partial-total cautions, source/page links, matching coverage, snapshot identity/date,
  and freshness notices. Only HTTP(S) source URLs from the API are accepted. The
  bilingual provider privacy notice links to Google's current terms; Phase 0's
  account-specific terms review remains required before launch.
- The panel uses 18px body text, 1.6 line height, visible focus, contrasting text,
  and controls/source links at least 44px high. It reflows at 320px and with 200%
  text enlargement. No dependency was added.

`npm run test:chat-ui` uses installed Playwright Chromium, the bundled snapshot,
the actual offline reference handler, and synthetic AI/error responses. It makes
no live Budget API or Gemini requests. It covers the main journey, source opening,
project-key-only context, Filipino/English, all response modes, facts/freshness,
bounded history, simplification/reset, duplicate prevention, literal HTML and unsafe
URLs, WAF/network errors and explicit retry, cancellation, focus/background inertness,
mobile controls, 200% text reflow, reload clearing, and ordinary portal navigation.

Verification passed: `test:chat-ui`, all 38 `test:chat` checks, all 36 `test:rag`
checks, `test:chat-setup`, `npm run build`, `npm run lint`, `npm run check` (21 live
GAA reconciliations), and the existing live Playwright project-scope check.
AI UI responses were mocked; protected-preview
and real-provider verification still belong to Phases 0/3.

- [ ] Manually verify the dialog, waiting/completion/error announcements, source
  navigation, readability, and text zoom with a screen reader and representative
  phone/keyboard users. Automated browser checks do not establish WCAG conformance.

## Phase 5 — Wire deployment and usage controls

**Depends on:** Phases 3–4.

Files: `package.json`, `vercel.json`, `.env.example`, `docs/deploy.md`, and the
deployment regression in `tests/chat.test.ts`.

- [x] Add a Vercel build command that refreshes the snapshot before the existing
  build, for example `npm run rag:build && npm run build`.
- [x] Preserve the normal offline-capable build using the reviewed snapshot. Test
  that a failed refresh prevents publishing a partial/new deployment.
- [x] Document `vercel dev` for full-stack local testing; `npm run dev` alone
  remains the frontend-only Vite workflow.
- [ ] Configure Preview and Production secrets independently, with AI initially
  enabled only in the protected preview.
- [x] Choose a supported Function duration above the application's 20-second
  upstream deadline so fallback responses have time to complete.
- [ ] For the public pilot, configure the available Vercel WAF rule for
  `/api/chat`, initially five requests/minute/IP. Verify the rule acts on the API,
  not static pages. Account for shared-network users and regional counters.
- [ ] Record actual Gemini limits and expected small-pilot usage. Do not describe
  client cooldowns, origin checks, or instance memory as a global quota cap.
- [x] Document how to switch to reference-only operation, rotate a compromised
  key, refresh data, and roll back a deployment.

- [x] Document the environment matrix, exact WAF setup/verification steps, proposed
  small-pilot usage and quota worksheet, and operational monitoring without treating
  per-IP or client controls as a global cap. Account-specific tasks above stay open.

**Exit:** private and public settings are reproducible, API routing is verified on
Vercel itself, and quota exhaustion has a tested user-facing outcome.

### Phase 5 usage and review — 2026-11-02

- `vercel.json` now runs `npm run build:vercel`, which uses the native npm shell
  chain `npm run rag:build && npm run build`. Refresh failure prevents the frontend
  build; build failure also exits nonzero. No catch-and-publish path or new
  dependency was added. The existing collector validates before atomic replacement;
  routine `npm run build` remains offline-capable.
- `tests/chat.test.ts` runs the actual configured deployment command/npm chain in a
  disposable directory with substituted refresh/build steps. It checks order,
  nonzero failures and that failed refresh never invokes the frontend build.
  `test:rag` separately exercises actual collector failures, incomplete/malformed
  data and last-good-snapshot retention. These do not simulate Vercel promotion.
- Existing snapshot inclusion, API-first/unknown-API-404 routing, no-store responses,
  the 30-second Function maximum and 20-second provider deadline are retained.
  Vercel's current documented Hobby Fluid Compute maximum supports 30 seconds;
  actual project/runtime settings must still be checked when deploying.
- [Deployment](deploy.md) now covers project setup, local full-stack testing,
  environment isolation, signed-out protection tests, deployed API/SPA/fallback
  checks, the exact five/minute/IP fixed-window WAF rule, edge 429/recovery and
  static-page checks, a ≤50-question/day supervised pilot, account quota recording,
  monitoring, reference-only operation, key revocation/rotation, refresh and rollback.
  Rollback's old environment/snapshot and old deployment URLs are accounted for.
- Official Vercel CLI, duration, WAF and rollback documentation was checked.
  The Gemini rate-limit documentation request timed out; no actual RPM/TPM/RPD or
  model eligibility is claimed. The operator must adjust the proposed pilot to
  verified account quotas before enabling it.

No Vercel CLI, linked project or process-level deployment credentials were available
in this workspace. No deployment, dashboard environment/protection change, WAF rule
publication or Gemini request was made. Account-dependent checkboxes and this
phase's live exit remain open; the reproducible steps and result worksheet are in
`docs/deploy.md`.

Verification passed: **39 `npm run test:chat` checks**, all 36 `test:rag` checks,
`test:chat-ui`, `test:chat-setup`, `npm run build`, `npm run lint`, and
`git diff --check`. The deployment-chain check substitutes expensive steps and the
provider/edge failure checks are mocked; no live snapshot refresh, account quota
exhaustion or Vercel promotion/enforcement is claimed.

## Phase 6 — Evaluate and run a small pilot

**Depends on:** all previous phases for public release.

- [x] Add approximately 30 reviewed evaluation questions, with expected evidence
  IDs and correct behavior rather than brittle exact AI wording:
  - Six definitions/methodology questions.
  - Eight project/name lookups across Filipino, English, and Taglish.
  - Six numeric comparison/aggregate questions.
  - Four ambiguous or missing-information questions.
  - Three out-of-scope requests.
  - Three prompt-injection/adversarial requests.
- [x] Verify amounts and aggregate calculations deterministically against raw source
  rows, including full-set aggregates, null/zero, separate years/versions and funded
  GAA counts.
- [ ] Manually review real generated claims for source support and comprehensible
  Filipino; valid citation IDs and synthetic output do not establish entailment.
- [x] Run separate offline fault checks for provider quota, timeout, invalid
  credentials, malformed output, missing snapshot, stale snapshot, and edge
  throttling/recovery. Deployed WAF/provider checks remain account-dependent.
- [x] Run the existing checks and the new focused tests listed below.
- [ ] Test with three to five representative readers, including seniors where
  possible. Observe whether they can identify the amount, budget stage, source,
  and limits without assistance; collect feedback without retaining transcripts.
- [ ] Fix unsupported claims, scope leaks, broken citations, financial errors, and
  blocking accessibility issues before enabling the public pilot.
- [ ] Review retrieval misses and actual provider usage before adding features.

- [x] Fix the observed exact-title retrieval miss in the shared retriever; add a
  regression for official title/ID tokens versus explicit filters and completion
  questions.
- [x] Add the per-case claim/language/citation review procedure, anonymous 3–5-reader
  task worksheet, fault-check map, usage/findings record and release decision in
  [the pilot record](pilot.md).

**Exit:** specification section 12 passes. A fluent but unsupported answer is a
failure, even if its citation ID exists.

### Phase 6 implementation and review — 2026-11-02

- `tests/chat-evaluation.json` records all 30 required questions against the reviewed
  snapshot, expected evidence/record IDs, modes, representative numeric facts and
  per-case human-review instructions. Its review basis is repository evidence;
  native-speaker, real-provider and participant reviews are explicitly pending.
- `npm run test:evaluation` runs each request through the HTTP handler in two modes:
  AI disabled and a synthetic provider. It checks membership, evidence, complete
  aggregate provenance, trusted source URLs/PDF pages, generation decisions,
  privacy canaries, and independently recomputes every returned fact from raw rows
  without using the production aggregation helpers. The corpus is snapshot-pinned
  so evidence changes require review rather than silently accepting new outputs.
- P07 exposed a real false no-data result: `FMR` inside an exact GAA family title
  was inferred as the unrelated FY2027 dataset filter. `server/rag.ts` now separates
  official titles/IDs from request intent before interpreting filters or claims.
  This also prevents `Completion` in an official title from becoming a completion
  question. Explicit year/program filters and actual completion questions retain
  precedence; existing callers use the shared fix.
- A fresh-process fault check injects ENOENT into the actual snapshot loader without
  moving/deleting the real file: the HTTP handler returns a private no-store 503
  with no provider call. Freshness checks exercise exactly seven days versus just
  over seven days. Existing provider HTTP 429/401/403, timeout and malformed-output
  checks are reused; quota/timeout now explicitly retain original facts/sources.
  Browser checks now also recover from non-JSON edge 429 with one explicit retry.
- [The pilot record](pilot.md) specifies real-generation entailment review, source
  opening and Filipino/English readability, phone/keyboard/screen-reader/zoom tasks,
  anonymous participant outcomes, actual usage review and a blocked release decision.
  It stores no resident transcripts and does not mistake mocked checks for a pilot.

No real generation, Vercel configuration or reader session was performed. The
previous account/deployment and human-review gates remain open. The observed
retrieval miss is fixed; broader synonyms, embeddings and provider changes require
observed pilot misses or usage evidence.

Verification passed: **94 `npm run test:evaluation` test entries** (30 questions in
two modes, parent cases and four corpus/fault/regression checks), all 39 `test:chat`
checks, all 36 `test:rag` checks, `test:chat-setup`, `test:chat-ui`, `npm run build`,
`npm run lint`, `git diff --check`, `npm run check` (21 live GAA department/year
reconciliations), and `npx tsx scripts/check-project-scope.ts`. No snapshot refresh
or Gemini request was needed. These results complete repository automation, not
the live/manual release exit.

## Verification commands

Already available:

```bash
npm run check
npm run build
npm run lint
npx tsx scripts/check-project-scope.ts
```

Available since Phase 1:

```bash
npm run rag:build
npm run test:rag
```

Available since Phase 3 (mocked provider, no credentials or network):

```bash
npm run test:chat
```

Available since Phase 4 (offline browser integration; needs Playwright Chromium):

```bash
npm run test:chat-ui
```

Available since Phase 6 (30 public questions, synthetic provider and local faults):

```bash
npm run test:evaluation
```

`test:rag` uses the installed `tsx` and Node's built-in test/assert modules with a
small deterministic fixture corpus. Extend it for retrieval/API checks in later
phases and mock the provider so routine tests consume no Gemini quota. Use existing
Playwright for browser integration. A manual real-provider smoke check remains
separate from the routine test suite.

## Minimum implementation inventory

| Path | Responsibility |
| --- | --- |
| `scripts/build-rag.ts` | Collect, validate, and atomically replace the snapshot |
| `data/rag/antipolo.json` | Reviewed/generated public-data snapshot |
| `data/rag/glossary.json` | Reviewed explanations with source references |
| `server/rag.ts` | Scoped retrieval, deterministic facts, reference responses |
| `server/chat.ts` | Prompt assembly, Gemini request, validation, fallback |
| `api/chat.ts` | Vercel HTTP entry point and boundary validation |
| `src/api/chat-types.ts` | Public transport contract, without secrets |
| `src/components/ChatPanel.tsx` | Accessible chat interaction |
| `scripts/check-chat-ui.ts` | Offline Playwright chat, keyboard, and reflow checks |
| `tests/rag.test.ts` | Focused data/retrieval/API financial and failure checks |
| `tests/chat-evaluation.json` | Reviewed evaluation questions and expected evidence |
| `tests/chat-evaluation.test.ts` | Offline evaluation, independent arithmetic, loader/freshness faults |
| `docs/pilot.md` | Human claim review, anonymous reader tasks, usage and release record |
| Existing config, UI, and deployment files | Integration described in each phase |

Keep this inventory small. Split modules only when the implementation needs it.
No embeddings service, persistent chat database, PDF pipeline, or provider-switching
framework is required to reach the first working demonstration.
