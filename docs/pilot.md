# Phase 6 — evaluation and pilot record

Status on **2026-11-02**: repository evaluation implemented; real-generation,
native-speaker, screen-reader and participant reviews **not run**. Public release
remains blocked on these reviews and the account/deployment gates in
[setup](ai-setup.md) and [deployment](deploy.md). Passing mocked checks is not a
claim that Gemini's explanations are factually supported.

## Reproduce the evaluation

```bash
npm run test:evaluation
npm run test:chat
npm run test:rag
npm run test:chat-setup
npm run test:chat-ui
npm run build
npm run lint
npm run check
npx tsx scripts/check-project-scope.ts
```

The first seven commands use the bundled evidence and no Gemini/network requests;
the last two read the public Budget API. Browser checks need installed Playwright
Chromium. None of these commands enables AI or changes account billing. Keep the
normal offline build for this review; `build:vercel` deliberately refreshes evidence.

Completed on **2026-11-02**: all 94 evaluation test entries (30 questions × two
modes, parent cases and four additional checks), 39 chat checks, 36 RAG checks,
setup/browser checks, build, lint and `git diff --check` passed. The live Budget API
check reconciled 21 department/year totals, and the live project-scope browser
check passed. No snapshot refresh, Gemini request or participant session was run.

`tests/chat-evaluation.json` contains **30 fixed public questions**: six definitions,
eight project/name lookups, six numeric comparisons/aggregates, four ambiguous or
missing-data questions, three out-of-scope requests, and three adversarial requests.
Each identifies expected record/evidence IDs, response behavior, representative
facts and a human-review instruction. The review basis is repository evidence, not
participant or native-speaker approval.

`npm run test:evaluation` sends every request through the real HTTP handler twice:
AI disabled and a synthetic provider. It checks retrieval, generation/no-generation
decisions, allowed citations, source-record URLs, separate years/versions, missing
versus zero, counts, provenance, and privacy canaries. Arithmetic is independently
recomputed from raw snapshot rows, without calling the production total helpers.
Full-set totals include more than six records. Synthetic prose tests the transport
and output validator, **not** real-generation entailment or prompt-injection immunity.

The corpus is pinned to its reviewed snapshot. After an intentional refresh,
review changed records, exclusions, expected amounts and citations before updating
its `snapshotId` and `reviewedAt`. Never replace an expectation merely with whatever
the current code returned. Evaluation data must stay public and synthetic; do not
add pilot conversations, names or credentials.

## Fault checks

| Fault | Runnable check and required outcome |
| --- | --- |
| Provider quota | `test:chat` → HTTP 429: one attempt, 200 reference answer, availability notice, original facts/sources retained |
| Timeout | `test:chat` → native abort deadline: configured 20-second signal, no retry, useful 200 reference answer |
| Invalid credentials | `test:chat` → HTTP 401/403: reference fallback, no key/provider body exposed |
| Malformed/unsupported output | `test:chat` → invalid JSON, unknown IDs, figures, blocked/truncated output: reference fallback without regeneration |
| Missing snapshot | `test:evaluation` → fresh-process actual loader receives ENOENT: friendly no-store 503, zero provider calls, private error/logs |
| Stale snapshot | `test:evaluation` → seven-day boundary: stale only after seven days, same snapshot identity, still useful sources/reference answer; UI shows freshness notice |
| Edge throttling | `test:chat-ui` → non-JSON 429: localized wait/retry, no automatic retry, one explicit retry recovers when allowed |

These are injected faults. The missing-file check does not rename/delete the real
snapshot. The timeout check accelerates the signal after asserting its configured
duration. Actual Vercel WAF enforcement, routing, static-page availability while
blocked, and recovery require the [deployed checks](deploy.md#public-pilot-waf-rule).
Never deliberately exhaust the real Gemini account or publish an invalid key or
missing snapshot to Production to simulate these faults.

## Real-generation and citation review

1. Finish Phase 0's free-tier/model/settings/terms verification and Phase 5's
   protected Preview and usage controls. Record the deployment, snapshot ID/date,
   exact model and check date. Keep Production AI disabled.
2. Use the fixed `request` objects from the corpus on the protected preview. Use
   project entry points for context; for API-only/adversarial shapes use a
   same-origin developer-console `fetch('/api/chat', { method: 'POST', headers:
   { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })` with
   the selected public request object. Do not include keys or personal data.
   Pace all evaluation submissions to at most three/minute to allow reading and
   stay below the initial per-IP WAF threshold.
3. With verified AI enabled, the six cases marked `expected.explanation: true`
   should produce `mode: "ai"`. Other valid cases keep their expected mode, and
   X03 returns 400. A fallback may be useful but does not count as a completed
   real-generation review; record it and resolve configuration/quota issues first.
4. For **every factual claim**, identify supporting supplied evidence and read it.
   Check title, agency, year, stage, amount and provisional status. Reject invented
   completion, services, actual spending, contractors, procurement or corruption.
   A valid citation ID alone does not pass. Open each cited API/PDF link, check the
   project and PDF page, and ensure GAA references have no fabricated page.
5. Have a fluent Filipino reviewer check familiar words, explained acronyms,
   preserved official titles, a short readable explanation (80–150 words is a
   target), and clear uncertainty/scope. Check English cases in English. Verify
   X01/X02 do not obey the injected instructions or repeat invented facts/URLs.
6. Record one decision for every D01–D06, P01–P08, N01–N06, A01–A04, O01–O03 and
   X01–X03. Note only case IDs, supporting evidence IDs, check results and issue
   descriptions; do not save a conversation transcript or resident questions.

| Case ID | Deployment / snapshot / model / date | Claims supported | Filipino/English clear | Links/pages checked | Pass/fail and issue |
| --- | --- | --- | --- | --- | --- |
| All 30 | **Not run** | Pending | Pending | Pending | Pending account access and human reviewers |

If a claim is unsupported, a source is broken or belongs to another project,
amounts are wrong, scope leaks, or accessibility blocks a task: keep AI disabled,
fix the shared cause, add the smallest regression, rerun the affected evaluation,
and repeat human review. Do not waive failures because the answer is fluent.

## Reader pilot (3–5 participants)

Use a protected, supervised pilot after the above checks. Recruit representative
readers, including seniors where possible, and include phone and keyboard users.
Review modal navigation/announcements with a real screen reader (such as NVDA with
Chrome), mobile reflow and 200% zoom. Automated browser checks are not WCAG approval.
Use the [usage plan](deploy.md#usage-budget-and-verification-record), adjusted to
actual quotas; at most ten questions per reader, no automatic generation retries.

Explain the Google/privacy notice and ask readers not to type personal information.
Give each reader these tasks without teaching the answer first:

1. Open chat and ask what NEP means; explain proposal versus enacted budget.
2. Open an in-scope project, ask for an explanation and identify its exact amount,
   fiscal year and budget stage.
3. Open a source and identify the same project/page or GAA family/agency/year.
4. Ask whether the project is finished or money spent; explain what cannot be known.
5. Find the snapshot date and explain why the live portal may be newer.
6. Switch language, simplify an answer, start a new conversation, and close/reopen
   using the intended device/input. Verify focus and announcements are usable.

Observe before assisting; record pass/needs-help/blocker per task. Ask what was
unclear in the labels, language or source navigation. Keep anonymous summary
counts and issue categories only: no names, contact details, recordings, quotations
containing personal data, raw prompts or transcripts. Clear the conversation with
“Bagong usapan” and reload between participants.

| Participant slot | Phone/keyboard/screen-reader/zoom used | Amount + stage | Source | Limits + freshness | Controls + language | Help/blockers |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Not run | Pending | Pending | Pending | Pending | Pending |
| R2 | Not run | Pending | Pending | Pending | Pending | Pending |
| R3 | Not run | Pending | Pending | Pending | Pending | Pending |
| R4 (optional) | Not run | Pending | Pending | Pending | Pending | Pending |
| R5 (optional) | Not run | Pending | Pending | Pending | Pending | Pending |

## Pilot usage, findings and release decision

Record only sanitized operational totals from AI Studio/Vercel and `chat` events.
Provider token metadata may be absent on failed calls; reconcile against AI Studio
instead of treating local logs as a complete global quota ledger.

| Measurement | Observed result |
| --- | --- |
| Pilot date, deployment/snapshot/model and quota verification date | Not run |
| Readers completed / questions / generation attempts | Not run |
| Actual RPM/TPM/RPD headroom, prompt/output/reasoning tokens | Pending account data |
| Latency and quota/timeout/invalid-output fallbacks | Not measured live |
| WAF blocks, shared-IP false positives, retry recovery | Not measured live |
| Retrieval misses by evaluation ID or anonymous issue category | P07 found/fixed: FMR in a GAA title was misread as a FY2027 program filter |
| New synonym/alias justified by observed misses | None yet; do not add embeddings or a new provider speculatively |
| Unsupported claims, financial/scope/citation/accessibility blockers | Offline checks pass only after fixes; real review remains pending |
| Release decision, reviewer and date | **Not approved — live/manual gates remain open** |

Public release requires every specification acceptance criterion, all 30 reviewed
case decisions, deployed routing/WAF/fallback checks, and at least three reader
sessions without unresolved blocking issues. Review misses and actual usage before
adding features. Refreshing evidence, changing the model or changing retrieval can
invalidate an earlier review; repeat the affected checks and record the version.
