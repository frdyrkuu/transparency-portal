# Deploying

The frontend build is static: `npm run build` → `dist/`. Browser routes
(`/districts`, `/projects/…`, `/about`) need an `/index.html` fallback. On Vercel,
files and API Functions must be checked **before** that fallback; unknown API paths
return 404.

Before deploying, run `npm run check`. It exits non-zero if an office name, district id
or exclusion does not match the API, so it can gate a CI deploy:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npm ci
- run: npm run check
- run: npm run build
```

## Cloudflare Workers (static assets)

`wrangler.jsonc` deploys `dist/` as static assets with single-page-application fallback.
No Worker code and no bindings.

```bash
# change "name" in wrangler.jsonc first
npx wrangler login
npm run deploy:cloudflare
```

Add a custom domain in the Cloudflare dashboard (Workers → your worker → Domains).

## Vercel

### Build and snapshot

Import the repository using the Vite framework preset, a supported Node.js version
(22.12+ or 24 LTS), and the repository root. Keep the repository's `vercel.json`
build command and output directory; remove conflicting dashboard overrides:

```bash
npm run build:vercel
# npm run rag:build && npm run build
```

Every Preview and Production build first collects and validates a complete
Antipolo snapshot from the public Budget API, then runs TypeScript and Vite. A
failed request, incomplete query, invalid scope or invalid record exits nonzero:
the frontend build does not run and Vercel must not promote the failed deployment.
The collector atomically replaces `data/rag/antipolo.json` only after validation.
Leave the previous successful deployment serving traffic; do not bypass a failed
refresh with an offline build or `--prebuilt` upload for a new chatbot release.

`npm run build` remains the offline-capable frontend build; it neither refreshes
data nor calls Gemini. Server tests can use the reviewed repository snapshot.
Static-only hosts serve the frontend, not the Vercel Function. A hosting build's
new snapshot is bundled into that deployment, not written back to Git.

The Function includes `data/rag/antipolo.json` and has `maxDuration: 30` seconds,
leaving time after the application's **20-second** upstream deadline to return
reference evidence. The client waits at most 30 seconds. Vercel's published Fluid
Compute Hobby maximum is 300 seconds as checked on 2026-11-02; confirm the actual
project runtime/plan supports the configured 30 seconds before deployment.

### Full-stack local testing

```bash
npm ci
npx vercel login
npx vercel link
npx vercel dev --listen 3000
```

Link to the intended existing project. Keep server-only Development configuration
in ignored `.env.local`, copied from `.env.example`, with `CHAT_ENABLED=false`.
Use `http://localhost:3000` for both the portal and `/api/chat`. The CLI may prompt
for account/project setup. It runs Vite behind the local API/router; `npm run dev`
alone is the frontend-only workflow and does not run this Function or the WAF.
Current FY2027 count/budget questions fetch the same four scoped project lists as
the dashboard, with pagination, region rules, exclusions and an eight-second
deadline. Gemini does not calculate these totals. A failed or invalid refresh uses
the reviewed snapshot with a visible notice and its original collection date.
`npm run test:chat` provides credential-free API, provider-failure and build-gate
checks; `npm run test:chat-ui` provides offline browser checks.

With `vercel dev` running, `npx tsx scripts/check-vercel-dev.ts` checks the actual
local router, Vite modules, SPA deep links, API 404/405 handling, and a reference
chat answer in Chromium. The glossary question needs no Gemini call. Pass a local
URL as an argument if you chose another port.

The SPA fallback covers extensionless page paths and excludes Vite's `/@…`,
`/src/`, and `/node_modules/` paths. Keep file/module requests out of that fallback:
rewriting them to `/index.html` makes `vercel dev` serve HTML as JavaScript and
causes Vite import-analysis errors. Unknown API paths retain their separate 404.

For a real local generation, first finish [Phase 0 setup](ai-setup.md), then enable
AI locally and run `npm run chat:check -- --live` for one explicit connectivity
request. Neither normal builds nor routine tests consume Gemini quota.

### Environment and preview protection

In **Settings → Deployment Protection**, enable **Vercel Authentication / Standard
Protection** before enabling Preview AI. Open the preview signed out to confirm
authentication is required. Standard Protection does not make the production
domain private; keep production AI disabled during private testing.

Create these variables independently in **Settings → Environment Variables**:

| Server variable | Development | Preview | Production before pilot |
| --- | --- | --- | --- |
| `CHAT_ENABLED` | `false` initially | `true` only after Phase 0 verification and protection check | Explicit `false` |
| `GEMINI_MODEL` | Exact verified model, if testing AI | Exact verified free-tier model | Unset |
| `GEMINI_API_KEY` | Dedicated local test key, if needed | Dedicated preview key | Unset |

Select only the intended environment when creating each value. Check for
branch-specific Preview overrides. Never use `VITE_` prefixes, commit local secret
files, or put keys in `portal.config.ts` or `vercel.json`. Environment changes apply
to **new deployments**; redeploy the affected environment and retest. Missing or
disabled provider configuration still serves the reference API.

When Phases 0/3/4/6 and the WAF checks below pass, separately set a dedicated
Production key, the verified model, and `CHAT_ENABLED=true` for Production, then
redeploy. Do not promote a Preview deployment as a substitute for a build with the
intended Production environment.

### Verify deployed routing and fallback

On a protected preview, verify these separately before calling Phase 3 complete
(the examples use POSIX shell quoting; on Windows use `curl.exe` or the browser's
same-origin developer console):

```bash
curl -i https://YOUR-PREVIEW/api/chat
curl -i -X POST https://YOUR-PREVIEW/api/chat -H "Content-Type: application/json" -d '{"message":"Ano ang NEP?"}'
curl -i -X POST https://YOUR-PREVIEW/api/chat -H "Content-Type: application/json" -d '{"message":"Ipaliwanag ang proyektong ito.","context":{"projectKey":"dpwh:house-reading:4279"}}'
curl -i https://YOUR-PREVIEW/api/does-not-exist
```

Use an authenticated preview session or privately configured protection bypass for
these requests; do not put a bypass secret in Git or shared logs. Expect 405 with
`Allow: POST`, a 200 JSON reference definition, a 200 sourced Filipino explanation
when verified AI is enabled (or useful reference data with `aiUnavailable: true`
when disabled), and a non-200 API 404. Chat responses must have `Cache-Control:
no-store`. Also open `/projects` directly to verify SPA navigation. The explanation
test checks that the deployed Function can load its snapshot. Inspect the figures
and citations manually; known IDs alone do not prove the generated claims.

Repeat the explanation request on a new Preview deployment with
`CHAT_ENABLED=false`: expect `mode: "reference"`, `aiUnavailable: true`, useful
facts/sources, and the availability notice. The definition stays provider-free
without that notice. Repeat routing/fallback checks on the Production domain
before enabling its AI. Record the deployment, environment, date and returned
snapshot ID/date without saving questions or credentials.

### Public-pilot WAF rule

Configure this in the project's **Firewall → Configure → New Rule**. WAF state is
an account setting, not a `vercel.json` application rate limiter:

| Field | Initial value |
| --- | --- |
| Name | `chat-per-ip-minute` |
| If | Request Path **equals** `/api/chat` (all methods) |
| Then | **Rate Limit** |
| Algorithm | **Fixed Window** |
| Time window | **60 seconds** |
| Request limit | **5** |
| Counting key | **IP** |
| Exceeded action | **Default (429)**, not Log or Challenge |

Save, **Review Changes → Publish**, and verify the rule is active on the intended
public domain. As checked on 2026-11-02, Vercel documents one rate-limit rule on
Hobby, within its three custom-rule allowance, with IP counting and fixed windows.
Check the account's remaining rules/usage and pricing before publishing. If that
rule slot is occupied, resolve it before opening the pilot; do not silently remove
an existing protection or enable paid service.

To verify without using Gemini, send six sequential `POST /api/chat` requests with
`{"message":"Ano ang NEP?"}` from one public IP within one fresh window. Confirm
200 JSON for allowed requests and 429 for excess requests in Firewall events,
attributed to this rule. Existing traffic can reach the limit earlier; a window
boundary can allow extra requests, so repeat inside one window if necessary.
While blocked, load `/`, `/projects`, and a static asset: these must still work.
Submit once from the chat panel while blocked: it must show a friendly retry
message even if the edge returns HTML. Wait over 60 seconds, then submit a
definition again and confirm recovery. Local/mock tests cannot prove edge behavior.

School, household, barangay and mobile-carrier networks can share an IP. Review
false positives with pilot readers before changing the threshold. Counters are
**regional**, and fixed windows can burst at boundaries. Multiple IPs/regions can
exceed five requests globally: this rule, origin checks, duplicate-submit controls
and instance memory are **not a global daily Gemini quota cap**.

### Usage budget and verification record

Start with **3–5 readers, at most 10 questions each in one pilot day**: at most 50
generation attempts if every question needs AI. Schedule at most three explanation
requests per minute across the supervised pilot. These are operating targets,
not enforced global limits. Definitions, direct figures and unsupported requests
usually require no generation; failures never trigger automatic retries.

At the approximately 4,000-input-token planning target and 600-output-token cap,
50 generations suggest roughly **200,000 input and up to 30,000 output tokens**;
three/minute suggests 12,000 input and up to 1,800 output tokens/minute. Character
limits do not enforce these input estimates. Check reasoning overhead, actual
`usageMetadata` and the provider's TPM accounting for the selected model. Reduce
the pilot to keep at least 20% headroom under each verified account limit, including
other consumers of the same Google project. Do not enable billing or a paid fallback.

Fill in this record from the account dashboards before enabling the public pilot;
the [Phase 0 record](ai-setup.md#verification-record) holds model/settings/terms details.
No account-specific quotas or live deployment results were available during this
implementation on 2026-11-02.

| Item | Actual result |
| --- | --- |
| Verification date, owner, Vercel plan/eligibility and remaining allowances | **Pending owner/dashboard verification** |
| Google project, exact model, free-tier/billing state | **Pending**; keep identifiers private if needed |
| Model/project RPM / TPM / RPD and any other limits | **Pending AI Studio check**, not inferred from public examples |
| Approved pilot readers / questions per day / peak explanations per minute | Proposed: 3–5 / ≤50 / ≤3; **pending adjustment to actual limits** |
| Preview authentication and isolated Preview/Production variables | **Pending signed-out and dashboard checks** |
| Deployment IDs, API/SPA routing, Function duration and snapshot loading | **Pending live Vercel checks** |
| WAF rule ID, production domain, date and 429/static/recovery results | **Pending configuration and live checks** |
| Disabled-AI and provider-quota user-facing outcomes | Mocked API/UI checks available; **pending deployed checks** |

During the pilot, review AI Studio usage/remaining quota, Vercel Function usage,
Firewall blocks, and the existing sanitized `chat` events (`category`, mode,
latency, model/snapshot and numeric token usage). `quota`, `timeout`,
`provider_http`, and `invalid_output` explain fallback rates without retaining
prompts or conversations. Provider 429 returns **200 reference evidence** with
`aiUnavailable: true`; edge 429 prevents the API from running and shows the retry
state. Do not deliberately exhaust the real account to test fallback: `test:chat`
mocks provider quota and `test:chat-ui` mocks non-JSON edge blocking.

### Operating steps

- **Reference-only:** set `CHAT_ENABLED=false` separately in the affected Vercel
  environments and redeploy each. Repeat the definition/project checks above.
  Existing deployments retain their old configuration; protect/delete obsolete
  AI-enabled deployment URLs if they are still publicly reachable. For an immediate
  stop while a redeploy builds, temporarily deny `/api/chat` in Firewall or revoke
  the provider key; restore the rate-limit rule after reference-only is verified.
- **Compromised key:** revoke it immediately in Google AI Studio (redeployment alone
  does not revoke it). Disable AI, create a replacement in the verified free project,
  update only its intended Vercel environment and ignored local copies, redeploy,
  and smoke-test before re-enabling AI. Use separate Preview/Production keys so a
  preview rotation does not require sharing the production secret. Inspect provider
  usage without copying secrets or raw requests into incident notes.
- **Refresh data:** run `npm run rag:build`, review the manifest/counts and changes
  in `data/rag/antipolo.json`, then `npm run test:rag`. Commit the reviewed public-data
  snapshot through the normal review process. A Vercel redeploy independently
  recollects before building; check the deployed answer's snapshot ID/date against
  its build log. On failure, keep the last good deployment and diagnose with
  `npm run check`; never deploy partial evidence or hand-edit its hash.
- **Rollback:** in Vercel's Production Deployment tile choose **Instant Rollback**,
  confirm the eligible previous deployment and domains, then rerun routing,
  snapshot, reference-only and WAF checks. Hobby supports the immediately previous
  deployment. Rollback restores its bundled snapshot and original environment,
  **not today's edited variables**: it can re-enable old AI settings or an old key.
  Revoke compromised keys first; use a fresh disabled-AI deployment when needed.
  WAF settings are separate, so verify them after rollback. Vercel suspends automatic
  production-domain assignment after rollback; promote a verified replacement or
  use **Undo Rollback** to restore normal releases.

Documentation checked on **2026-11-02**:
[CLI/local development](https://vercel.com/docs/cli/dev),
[Function duration and plan limits](https://vercel.com/docs/functions/configuring-functions/duration),
[WAF setup and regional counters](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
and [Instant Rollback](https://vercel.com/docs/instant-rollback).
The Gemini limits documentation request timed out again; actual project limits
must be read in [AI Studio](https://aistudio.google.com/) and checked against
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) by the owner.

## Netlify

Import the repository. `netlify.toml` sets the build and the 200 redirect to
`index.html`.

## GitHub Pages and plain web servers

Serve `dist/`. For the fallback, copy `dist/index.html` to `dist/404.html` (GitHub Pages),
or configure the server (nginx: `try_files $uri /index.html;`).

## Link previews

Set `siteUrl` in `portal.config.ts`. The build writes the portal's name, description and
canonical URL into `index.html`, so link previews show the right portal.

## The API host

The portal reads `https://budget.bettergov.ph` unless `api` is set in the config or
`VITE_API_BASE` is set at build time. The API is CORS-open and edge-cached, so no proxy
is needed.
