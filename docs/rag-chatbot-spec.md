# Antipolo Budget Assistant — MVP specification

Status: snapshot, deterministic retrieval/reference responses, Vercel/Gemini API,
and bilingual accessible chat UI implemented (Phases 1–4). Phase 5 adds refresh-gated
Vercel builds and a deployment/usage runbook. Account configuration, actual quotas,
live Vercel/WAF verification, protected-preview/real-provider verification and manual
screen-reader/readability review remain pending. Phase 6's 30-question offline
evaluation and pilot protocol are implemented; real claim/language review and
3–5-reader sessions remain pending in [the pilot record](pilot.md).

Date: 2026-11-01.

Implementation tasks: [Implementation plan](implementation-plan.md).

## 1. Purpose

Help residents, especially senior citizens and people unfamiliar with budget
terminology, understand the information already available in the Antipolo portal.
Success means a readable, source-supported explanation, not just fluent AI text.

Example questions:

- “Ano ang ibig sabihin ng NEP?”
- “Ipaliwanag mo ang proyektong ito.”
- “May nakalistang proyekto para sa kalsada sa Mayamot?”
- “Magkano ang nakalista para sa proyektong ito?”
- “Ano ang pinagkaiba ng panukalang budget at batas na budget?”

## 2. Agreed direction

| Area | MVP decision |
| --- | --- |
| Hosting | Existing React/Vite application on Vercel |
| Backend | One Vercel Node.js Function: `POST /api/chat` |
| AI | Gemini API using a model confirmed as free-tier eligible for the account |
| Language | Simple Filipino by default; English switch; understand common Taglish |
| Evidence | Antipolo-scoped Budget API records and reviewed budget explanations |
| Retrieval | Keyword and phrase search with a small Filipino–English synonym list |
| Storage | A generated JSON snapshot bundled with the server |
| Conversation | In-memory browser session; no saved transcripts |

Retrieving relevant evidence before generating an explanation is RAG. The initial
corpus is small enough to start without embeddings, a vector database, or an AI
orchestration framework. Add semantic retrieval only if evaluation shows that the
simpler search misses important questions.

## 3. Scope and factual boundaries

The assistant may explain terms, find scoped records, explain a selected project,
and compare or summarize published amounts. Every factual answer must be supported
by the available evidence.

It must distinguish:

- National budget records naming Antipolo from the complete Antipolo City Hall budget.
- Proposed appropriations from enacted appropriations.
- An appropriation from money actually spent.
- A provisional comparison label from a confirmed change or irregularity.
- Missing information from proof that a project does not exist.

The current scope searches for `Antipolo City` and applies Region IV-A to the 2027
results, retaining records without a region as the portal already does. The GAA
has no region filter. Location coverage is title-based, not a geographic survey;
the assistant must not claim to cover every project physically in Antipolo.

Budget stages and years must come from the evidence, not assumptions about today's
date. The current 2027 dataset compares the NEP and House bill, while the 2020–2026
dataset contains enacted appropriations.

Do not invent project completion, procurement, contractor, disbursement, or
corruption information. For a completion question without evidence, say:

> Hindi ipinapakita ng tala kung tapos na ang proyekto. Ang makikita rito ay ang
> halagang nakalista sa dokumento ng budget.

Questions about other cities should receive a brief Antipolo-scope explanation,
not a nationwide search. General budget definitions remain supported.

## 4. Request flow

```text
React chat panel
  → POST /api/chat
  → Validate question, language, and optional project context
  → Retrieve scoped records and/or reviewed explanations
  → Compute facts and comparisons in TypeScript
  → Clarify or return no-data if evidence is insufficient
  → Return a reviewed/reference answer when AI is unnecessary
  → Otherwise make one Gemini generation request with selected evidence
  → Validate output and citation IDs
  → Return explanation, server-built facts, sources, and snapshot date
```

The server owns retrieval and source selection. It must never accept browser-supplied
records, amounts, URLs, or previous AI statements as authoritative evidence.

## 5. Knowledge snapshot

Add `npm run rag:build` to generate a snapshot using the existing functions:

- `resolveScope()` in `src/lib/scope.ts` for the four FY2027 datasets.
- `resolveGaa()` in `src/lib/gaa.ts` for enacted-budget program families.
- `summarise()` and `gaaYearTotals()` for compatible calculations.

Reuse `portal.config.ts`; do not implement a second Antipolo location rule. Reject
a changed configuration that broadens this chatbot beyond its declared city scope.

### Knowledge units

Keep structured records rather than splitting amounts and citations across arbitrary
text chunks:

1. One FY2027 project per record.
2. One GAA program family per record, with separate year-specific amounts.
3. One reviewed glossary or methodology explanation per record.

Each unit preserves its stable ID, original title, record type, scope ID, program
or department, fiscal year/budget version, amounts, status, and available sources.
The snapshot manifest records:

- Schema version and content-derived snapshot ID.
- Portal ID and a fingerprint of the effective scope.
- Collection timestamp.
- Source commit/build metadata where supplied, separately from collection time.
- Record counts, exclusions, and completeness of source queries.

Preserve existing PDF URLs and page references. For GAA records without a PDF page,
cite the API query/department reference and identify the program family and year.
Do not manufacture a PDF citation. Reviewed definitions must identify their
underlying methodology/API source.

### Refresh and freshness

- Generate a complete snapshot before a chatbot deployment; provide manual refresh.
- A failed required request, truncated query, or invalid scope fails generation.
- Write the final snapshot only after validation; do not replace good data with a
  partial result. A failed deployment leaves the previous deployment available.
- The main portal may show newer live data than the chatbot snapshot. Display the
  chatbot's collection date and available source version; never call it real-time.
- Show a freshness notice after seven days without collection. A recent collection
  date does not imply that the upstream dataset itself was recently rebuilt.
- If a project is absent from the snapshot, explain that it cannot currently be
  summarized. Do not substitute a similar project.
- If a browser supplies an obsolete snapshot ID, use the current server snapshot
  and report its identity; never mix versions within an answer.

## 6. Retrieval and arithmetic

Normalize case, whitespace, and punctuation. Prefer exact project IDs and phrases,
then meaningful names and keywords. Expand a small reviewed synonym list such as
`kalsada`/`road`, `tulay`/`bridge`, and `ospital`/`hospital`. A broad word such as
`pondo` must not by itself identify a project.

Apply explicit year, program, and selected-project filters before ranking. Retrieve
up to six records for explanation. If multiple projects or budget versions could
answer the question, ask a short clarification question.

Bounded conversation context may resolve “ito” or “iyong proyekto.” An explicit
current question overrides old context. Previous AI answers are not evidence.

All amounts, counts, rankings, and differences are computed in TypeScript:

- Aggregate over the complete matching set, not the six explanation results.
- Never add NEP and House bill amounts together.
- Keep fiscal years separate unless an explicit, meaningful cross-year calculation
  is requested and clearly labeled.
- Keep missing amounts distinct from zero.
- Count a GAA year as funded only when its amount is above zero.
- Preserve exclusions, provisional labels, and unconfirmed-match notes.
- Label totals as this portal's matching records, not the city's complete budget.

For “Magkano ang budget ng Antipolo?”, clarify the year, version, and coverage.
If the intended filter cannot be resolved reliably, do not ask Gemini to guess or
perform the calculation. Return a clarification or a link to the filtered list.

## 7. Answer and citation standard

An ordinary response has a short explanation, up to three detail bullets when
useful, readable source links, and any limitation necessary to interpret it.
Target 80–150 words; this is a writing target rather than a claim about model limits.

Language requirements:

- Use familiar Filipino words and explain acronyms on first use.
- Preserve official project titles and avoid patronizing wording.
- Support an English switch and “Mas simpleng paliwanag.”
- Keep numeric budget figures in server-built fact cards; AI prose explains their
  meaning rather than introducing new calculations or amounts.
- Make exact peso figures available alongside readable formatting.

Every factual budget claim must be supported by supplied evidence. The model may
return only citation/fact IDs from that evidence. The server resolves IDs to trusted
records and URLs. Reject invalid IDs, malformed output, or an empty/unsupported
explanation and return reference information instead, without a second generation
attempt.

Valid IDs establish source membership, not factual entailment. Evaluation must
also check that the cited evidence supports the explanation. Do not promise that
RAG eliminates hallucinations.

## 8. Senior-friendly interface

Entry points:

- A labeled “Magtanong tungkol sa budget” button.
- “Ipaliwanag ang proyektong ito” on an in-scope project page.
- Suggested questions for common tasks.

Target WCAG 2.2 AA. Use approximately 18px chat body text, line height of at least
1.5, primary touch targets of at least 44 × 44px, and normal-text contrast of at
least 4.5:1. Check keyboard controls, visible focus, narrow-screen reflow, 200% text
zoom, labels, and screen-reader announcements. If implemented as a modal, manage
focus and return it to the opener when closed.

Do not open the panel automatically or unexpectedly move focus when an answer
arrives. Announce completion politely. Show the complete short response instead
of a token-by-token animation.

Include language switching, “Bagong usapan,” clear source buttons, waiting and
retry states, and a visible snapshot date. Distinguish an AI explanation from a
direct/reference answer. Normal portal browsing must work when chat is unavailable.

## 9. API contract and limits

`POST /api/chat` accepts JSON such as:

```json
{
  "message": "Ipaliwanag ang proyektong ito.",
  "language": "fil",
  "context": {
    "projectKey": "dpwh:house-reading:4279"
  }
}
```

`language` accepts `fil` or `en`; default to `fil`. Context is optional. The server
checks project membership in its own snapshot. At most two recent exchanges may
be supplied for follow-up resolution, with each message limited to 500 characters.
The implemented optional `history` shape is `[{ "user": "…", "assistant": "…" }]`.
Optional `context.snapshotId` may identify an old browser snapshot; it never overrides
the server's current snapshot. Optional `filters` accept `year`, `stage`, `program`,
and `projectKey` as described in the Phase 2 implementation notes.

Response shape:

```json
{
  "mode": "ai",
  "answer": "Maikling paliwanag batay sa mga nakuhang tala.",
  "facts": [],
  "sources": [],
  "snapshot": {
    "id": "snapshot-version",
    "collectedAt": "ISO-8601 timestamp"
  }
}
```

Facts have stable IDs, labels, typed values/units, fiscal-year/version context,
and source IDs. Sources have an ID, title, trusted URL, and optional document page.
The server builds these objects; Gemini only selects allowed IDs and explanation
text. All records cited in an aggregate remain traceable through its filter,
count, snapshot, and supporting source references.
The implemented response also includes `citationIds`, `factIds`, freshness fields
under `snapshot`, and full `provenance`. AI-unavailable reference results set
`aiUnavailable: true`; error responses use `{ "error": { "code": "…", "message": "…" } }`.

Modes are `ai`, `reference`, `clarification`, and `no_data`. A valid request with
no evidence is a `200` no-data response, not an API failure.

| Application setting | Initial limit |
| --- | --- |
| Current question | 500 characters |
| Entire request | 8 KB, enforced before unbounded parsing |
| Conversation | Two recent exchanges, separately length-limited |
| Explanation evidence | Six records maximum |
| Serialized generation input | 12,000 characters maximum, including instructions and history |
| Input token target | Approximately 4,000; character limits are not exact token limits |
| Generated output | Approximately 600 tokens maximum, within the selected model's settings |
| Generation requests | At most one per submitted question |
| Upstream timeout | 20 seconds |
| Automatic generation retries | None |

If evidence exceeds the input bound, reduce ranked explanation records while
preserving coherent facts and citations. Do not silently truncate an aggregate's
underlying record set. Account for any model reasoning-token overhead when choosing
and configuring the model; do not assume all model settings are interchangeable.

Return `400` for invalid input, `405` for unsupported methods, and `413` for an
oversized body. Application/edge throttling returns `429`; the client must handle
non-JSON edge responses too. Provider timeout, quota exhaustion, missing AI
configuration, or `CHAT_ENABLED=false` should return available reference results
with an explanation that AI is unavailable. If evidence cannot be served at all,
return a friendly `503` and keep the normal portal accessible.

Chat responses use `Cache-Control: no-store` to avoid shared caching of questions.

## 10. Free-tier operation

Server-only environment variables:

```text
GEMINI_API_KEY
GEMINI_MODEL
CHAT_ENABLED
```

`GEMINI_MODEL` must be a currently available model verified as free-tier eligible
for this account. Model IDs and quotas are not guaranteed by this document. Never
silently switch to paid models/providers. Do not create `VITE_GEMINI_API_KEY`:
Vite-prefixed values are exposed to the browser.

Reduce usage by serving reviewed glossary and straightforward reference answers
without generation, sending only relevant evidence, and preventing duplicate
in-flight submissions. Do not retry upstream quota errors in a loop.

On provider exhaustion, keep the evidence useful:

> Hindi muna available ang AI na paliwanag. Narito ang mga kaugnay na tala at
> dokumento.

For a public pilot, configure Vercel's available WAF rate-limiting rule for
`/api/chat`, initially five requests per minute per IP. Adjust to actual provider
limits and shared-network use. Vercel documents regional counters: this is abuse
control, not an exact global daily budget. Client cooldowns and per-instance
memory are also not distributed quota enforcement.

Target $0 additional service cost while within eligible free allowances. Gemini
and Vercel have usage limits; this is not unlimited public chat. Vercel Hobby is
for personal, non-commercial use, so check eligibility for the intended operator.
Do not enable paid billing just to bypass a failed demo.

## 11. Security and privacy

- Keep secrets out of browser bundles, Git, logs, and API error details.
- Validate all input and selected-project IDs at the server boundary.
- Treat user messages and retrieved text as data, not instructions to override
  the assistant's scope or reveal secrets (prompt-injection resistance).
- No arbitrary URL fetching, user-uploaded files, or model-selected tools.
- Render escaped text, not raw model HTML; resolve citations from server records.
- Use same-origin requests and validate expected origins where applicable, but do
  not treat CORS/origin checks as authentication or sufficient abuse protection.
- Do not persist conversations. Clear the in-memory conversation on “Bagong usapan.”
- Log latency, mode, error category, model/snapshot version, and provider token
  usage when returned; do not log full questions or raw prompts by default.
- Explain that AI questions/context go to Google; ask users not to include personal
  or sensitive information. Review current free-tier data-use terms before launch.

## 12. Acceptance criteria

Before public release:

- No out-of-scope project is retrieved or accepted through a forged context ID.
- Tested amounts, null handling, year counts, comparisons, and totals match source
  records; aggregate answers use the complete matching set.
- Citations resolve and support the claims made. Unknown completion/spending facts
  receive an honest limitation, not an invented answer.
- Filipino, English, and common Taglish inputs retrieve expected evidence.
- Ambiguous questions clarify; missing records and provider failures remain useful.
- Prompt-injection attempts do not broaden scope or reveal configuration.
- `/api/chat` produces API responses rather than the SPA HTML fallback.
- Keyboard, mobile, zoom, and screen-reader checks pass.
- Existing build, lint, API-scope, and project-scope checks continue to pass.

Keep approximately 30 evaluation questions covering definitions, project lookup,
aggregates, ambiguity, missing data, out-of-scope requests, and adversarial input.
Use deterministic checks for financial logic and human review for explanation
quality. A supported citation ID alone does not count as a passed factual test.

## 13. Deferred capabilities

Embeddings/vector search, persistent history, voice input/read-aloud, PDF OCR,
scheduled refresh, shared response caching, and additional AI providers are outside
the MVP. Add them only when pilot evidence demonstrates a need.

## 14. References and verification status

- Existing evidence contract: [Budget API](api.md).
- Existing hosting instructions: [Deployment](deploy.md).
- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js).
- [Vercel Function limits](https://vercel.com/docs/functions/limitations).
- [Vercel Hobby eligibility and allowances](https://vercel.com/docs/plans/hobby).
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
- [Gemini terms](https://ai.google.dev/gemini-api/terms).
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Vercel documentation was read during planning on 2026-11-01. Gemini documentation
requests timed out. Exact model availability, account quotas, supported generation
settings, and data-use terms remain setup-time verification items. Recheck hosting
eligibility and provider allowances before launch because they can change.
