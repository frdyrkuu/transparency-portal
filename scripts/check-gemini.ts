/** Phase 0 CLI only: no network unless --live is explicitly supplied. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { argv, env, loadEnvFile } from 'node:process';

const generationConfig = {
  temperature: 0,
  maxOutputTokens: 600,
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'OBJECT',
    properties: { answer: { type: 'STRING' } },
    required: ['answer'],
  },
};

async function check(settings: NodeJS.ProcessEnv, live = false, send: typeof fetch = fetch) {
  for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'CHAT_ENABLED']) {
    if (settings[`VITE_${name}`] !== undefined) throw new Error(`Remove VITE_${name}; chat configuration must be server-only.`);
  }
  const enabled = settings.CHAT_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false') throw new Error('CHAT_ENABLED must be true or false.');
  if (enabled === 'false') {
    if (live) throw new Error('Live check requires CHAT_ENABLED=true after completing docs/ai-setup.md.');
    return { status: 'disabled', networkRequests: 0 };
  }
  const key = settings.GEMINI_API_KEY?.trim();
  const model = settings.GEMINI_MODEL?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is required when chat is enabled.');
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) {
    throw new Error('GEMINI_MODEL must be the exact verified model ID, without a models/ prefix.');
  }
  if (!live) return { status: 'configured', model, networkRequests: 0 };

  // Fixed public prompt: no resident question or private account data is sent.
  let result: unknown;
  try {
    const response = await send(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Return JSON with answer set to "Handa ang pagsubok.". This is a connectivity test.' }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    // Never print provider bodies, request headers, or raw network errors.
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}; no retry or fallback was attempted.`);
    result = await response.json();
  } catch (error) {
    if (error instanceof Error && /^Gemini HTTP \d{3};/.test(error.message)) throw error;
    // eslint-disable-next-line preserve-caught-error -- Raw provider errors may contain credentials.
    throw new Error('Gemini request failed, timed out, or returned invalid JSON; no retry was attempted.');
  }
  try {
    const { candidates } = result as { candidates: { content: { parts: { text?: string }[] } }[] };
    const text = candidates[0].content.parts.map((part) => part.text ?? '').join('');
    const answer: unknown = JSON.parse(text);
    assert.ok(answer && typeof answer === 'object' && 'answer' in answer && typeof answer.answer === 'string' && answer.answer.trim());
  } catch {
    throw new Error('Gemini did not return the required nonempty JSON answer. Check model settings in docs/ai-setup.md.');
  }
  return { status: 'generated', model, checkedAt: new Date().toISOString(), generationConfig, networkRequests: 1 };
}

async function selfTest() {
  const settings = { CHAT_ENABLED: 'true', GEMINI_MODEL: 'test-model', GEMINI_API_KEY: 'secret-canary' };
  let calls = 0;
  const send: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), settings.GEMINI_API_KEY);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.generationConfig, generationConfig);
    assert.ok(!String(init?.body).includes(settings.GEMINI_API_KEY));
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"answer":"Handa."}' }] } }] });
  };
  assert.equal((await check({}, false, send)).status, 'disabled');
  assert.equal((await check(settings, false, send)).status, 'configured');
  for (const bad of [
    { ...settings, CHAT_ENABLED: 'yes' },
    { ...settings, GEMINI_API_KEY: '' },
    { ...settings, GEMINI_MODEL: '' },
    { ...settings, GEMINI_MODEL: '../other-model' },
    ...['GEMINI_API_KEY', 'GEMINI_MODEL', 'CHAT_ENABLED'].map((name) => ({ ...settings, [`VITE_${name}`]: 'unsafe' })),
  ]) await assert.rejects(check(bad, true, send));
  await assert.rejects(check({}, true, send));
  assert.equal(calls, 0);
  assert.equal((await check(settings, true, send)).status, 'generated');
  assert.equal(calls, 1);
  for (const status of [400, 401, 403, 429, 500]) {
    let attempts = 0;
    await assert.rejects(check(settings, true, async () => {
      attempts++;
      return new Response('secret provider body', { status });
    }), new RegExp(`^Error: Gemini HTTP ${status};`));
    assert.equal(attempts, 1);
  }
  for (const result of [{}, { candidates: [] }, { candidates: [{ content: { parts: [{ text: '{"answer":""}' }] } }] }]) {
    await assert.rejects(check(settings, true, async () => Response.json(result)), /required nonempty JSON answer/);
  }
  await assert.rejects(check(settings, true, async () => new Response('not JSON')), /returned invalid JSON/);
  await assert.rejects(check(settings, true, async () => { throw new Error(settings.GEMINI_API_KEY); }), /Gemini request failed/);
  await assert.rejects(check(settings, true, async () => { throw new DOMException('secret', 'TimeoutError'); }), /timed out/);
  console.log('Chat setup self-check passed (no network or credentials).');
}

async function main() {
  const args = argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.length > 1 || args.some((arg) => arg !== '--live')) throw new Error('Usage: npm run chat:check [-- --live]');
  if (existsSync('.env.local')) loadEnvFile('.env.local');
  console.log(JSON.stringify(await check(env, args.includes('--live')), null, 2));
}

main().catch((error: unknown) => {
  // Only our fixed validation messages are safe; file-loader errors can contain secrets.
  const message = error instanceof Error ? error.message : '';
  console.error(/^(Remove VITE_|CHAT_ENABLED |Live check |GEMINI_API_KEY |GEMINI_MODEL |Gemini |Usage: )/.test(message)
    ? message : 'Chat setup check failed; verify .env.local and rerun test:chat-setup.');
  process.exitCode = 1;
});
