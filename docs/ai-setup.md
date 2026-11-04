# Phase 0 — private Gemini setup

Status on **2026-11-01: repository setup ready; account verification blocked**.
No Vercel/Google account access or Gemini credentials were available. No project,
key, billing change, deployment, or real generation was created by this work.
Phase 0 is complete only after the owner fills in the record below and a live
check succeeds. A successful generation alone does not prove free-tier eligibility.

## Verification record

Record account identifiers privately if needed; never put a key here.

| Item | Verified result / action still needed |
| --- | --- |
| Documentation check date | 2026-11-01 |
| Intended operator and purpose | **Pending owner confirmation**: individual personal/non-commercial project, or organization/commercial operation? |
| Actual Vercel plan | **Pending dashboard check**; do not assume Hobby eligibility from the repository's license or civic purpose |
| Hosting eligibility | Hobby allows personal, non-commercial use only; owner must confirm this deployment qualifies or record the actual plan and limits |
| Published Hobby limits | Monthly: 1,000,000 Function invocations, 4 active CPU-hours, 360 GB-hours provisioned memory, 100 GB fast data transfer, 10 GB fast origin transfer, 1,000,000 CDN requests; 100 deployments/day; documented Function maximum 300 seconds |
| Protected preview | Vercel Authentication / Standard Protection available on all plans; **pending enablement and signed-out URL test** |
| Google AI Studio project | **Pending**: select/create a dedicated project and verify its tier/billing state |
| Dedicated Gemini API key | **Pending**: create in AI Studio; store only in local/server environment |
| Exact free-tier text model ID | **Pending**: verify current pricing and availability for this project; no default model is assumed |
| Account RPM / TPM / RPD | **Pending**: copy the selected project's actual requests/minute, tokens/minute and requests/day limits from AI Studio, including any other applicable limits; record check date |
| Output/settings support | **Pending live confirmation**: `v1beta` `generateContent`, `systemInstruction`, JSON MIME type, `responseSchema`, temperature `0`, `maxOutputTokens: 600`; account for reasoning-token overhead before selecting a model |
| Gemini data-use terms | **Pending**: official terms/pricing/limits/structured-output fetches failed or timed out on 2026-11-01; terms were not verified |
| Free setup / billing | **Pending dashboard confirmation**: intended free tier, billing not enabled for this test, selected model has free input/output allowance; no paid fallback |
| Minimal generation | **Not run**: record date, exact model and sanitized `chat:check -- --live` output after verification |

Vercel figures above are published plan allowances, not this account's remaining
usage. Recheck them against the account before deployment. Hitting Hobby allowances
can pause features; they do not promise unlimited chat.

Sources read on 2026-11-01:

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Deployment Protection](https://vercel.com/docs/deployment-protection)

Sources the owner must review before enabling AI:

- [Google AI Studio projects and keys](https://aistudio.google.com/api-keys)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini account rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini additional terms](https://ai.google.dev/gemini-api/terms)

## Configure and test locally

1. Review the sources above. In AI Studio, select/create the project, check the
   actual free tier, model and quotas, and create a dedicated API key. Do not enable
   billing to make a failed check pass. If free use is unavailable, keep AI disabled.
2. Copy `.env.example` to `.env.local`. It is ignored by Git. Set the exact verified
   model ID and key there; leave `CHAT_ENABLED=false` until the record is verified.
   The script reads `.env.local`; existing process environment values take priority.
   All three names are server-only, never `VITE_`-prefixed. Do not paste keys into
   terminal commands, chat, screenshots, source files, or this record.
3. Run the offline check and tests (no key or provider access required):

   ```bash
   npm run chat:check
   npm run test:chat-setup
   ```

4. After verifying the account, set `CHAT_ENABLED=true` in `.env.local`. Running
   `npm run chat:check` now validates configuration without making a request.
   To explicitly perform **one** server-side request:

   ```bash
   npm run chat:check -- --live
   ```

   This sends a fixed, non-sensitive connectivity prompt to the exact configured
   model. It uses native Node `fetch`, a 20-second timeout, JSON structured output,
   and no retries, alternate models, SDK, or paid fallback. It prints only the
   configured model, check date, settings and success status, never the key,
   generated answer or provider error body. Failure exits nonzero. Settings shown
   in the verification record are requirements of this probe, not a claim that an
   unverified model supports them. If it fails, check the model documentation and
   record the cause; do not silently change to a different model.
5. Record the result above, then return `CHAT_ENABLED=false` until the private
   end-to-end chat implementation is ready. Normal frontend builds and offline
   self-checks do not call Gemini.

## Start on a protected Vercel preview

1. Confirm the actual plan and eligibility with the deployment owner.
2. In the project's **Settings → Deployment Protection**, enable **Vercel
   Authentication** with **Standard Protection** before sharing a preview URL.
   Check the preview in a signed-out/private browser: it must require authentication.
3. In **Settings → Environment Variables**, add `GEMINI_API_KEY`, `GEMINI_MODEL`, and
   `CHAT_ENABLED` for **Preview only**. Keep `CHAT_ENABLED=false` initially. Production
   must remain disabled (unset or `false`), with no Gemini key until separately
   approved for launch. Redeploy after changing environment variables.
4. Do not add these values to `portal.config.ts`, Vite `define`, browser code or
   `vercel.json`. Vite currently exposes only `VITE_`-prefixed values; the smoke script
   lives in `scripts/` and is not imported by the application.

Phase 3 now implements `/api/chat` as a Vercel Function with reference-only fallback;
its protected-preview/real-provider verification remains pending. Follow the checks
in [deployment](deploy.md); a static-only host or `npm run dev` does not run the API.
The local probe still provides Phase 0's separate minimal connectivity check.

## Short user-facing privacy notice

Displayed in the Phase 4 chat panel; finalize after checking the selected free-tier
terms, including improvement/training use, human review and retention. Do not claim
that provider data is never retained or used for training without verification.

**Filipino:** Kapag ginamit ang AI na paliwanag, ipapadala sa Google Gemini ang
iyong tanong at kaugnay na konteksto. Maaaring gamitin ang mga ito para mapahusay
ang mga serbisyo at masuri ng tao, ayon sa mga tuntunin ng Google. Huwag maglagay
ng personal o sensitibong impormasyon. Hindi iniimbak ng portal ang usapan;
mawawala ito kapag ni-reload o sinimulan ang bagong usapan.

**English:** When you use an AI explanation, your question and relevant context
are sent to Google Gemini. They may be used to improve services and reviewed by
people under Google's terms. Do not include personal or sensitive information.
The portal does not save conversations; reloading or starting a new conversation
clears them.

The chat panel implements this in-memory behavior and links the notice to the
current Gemini terms. Account-specific terms verification remains pending.

## Repository checks — 2026-11-01

Passed: `npm run test:chat-setup`, `npm run chat:check` (disabled, zero requests),
`npm run build`, `npm run lint`, `npm run check`, and
`npx tsx scripts/check-project-scope.ts`. The build was also checked with fake
server-only Gemini values: neither the canaries nor the three configuration names
appeared in `dist/`. Git ignores environment variants while retaining `.env.example`.
These checks verify repository behavior, not account eligibility or Gemini access.
