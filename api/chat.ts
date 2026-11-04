import type { ChatError, ChatRequest } from '../src/api/chat-types.ts';
import { answerChat, type ChatOptions } from '../server/chat.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

function validRequest(value: unknown): value is ChatRequest {
  if (!object(value) || !keys(value, ['message', 'language', 'context', 'filters', 'history']) || !text(value.message)
    || (value.language !== undefined && value.language !== 'fil' && value.language !== 'en')) return false;
  if (value.context !== undefined && (!object(value.context) || !keys(value.context, ['projectKey', 'snapshotId'])
    || (value.context.projectKey !== undefined && !text(value.context.projectKey))
    || (value.context.snapshotId !== undefined && !text(value.context.snapshotId)))) return false;
  if (value.filters !== undefined) {
    const f = value.filters;
    if (!object(f) || !keys(f, ['year', 'program', 'projectKey', 'stage'])
      || (f.year !== undefined && (!Number.isSafeInteger(f.year) || Number(f.year) < 1900 || Number(f.year) > 2199))
      || (f.program !== undefined && !text(f.program)) || (f.projectKey !== undefined && !text(f.projectKey))
      || (f.stage !== undefined && (typeof f.stage !== 'string' || !['nep', 'house', 'hgab2', 'hgab3', 'api', 'gaa'].includes(f.stage)))) return false;
  }
  if (value.history !== undefined && (!Array.isArray(value.history) || value.history.length > 2
    || !value.history.every((exchange) => object(exchange) && keys(exchange, ['user', 'assistant']) && text(exchange.user) && text(exchange.assistant)))) return false;
  return true;
}

/** Web-standard handler: read bytes before JSON parsing, including chunked requests. */
export async function handleChat(request: Request, options: ChatOptions = {}): Promise<Response> {
  const started = Date.now();
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
  const error = (status: number, code: ChatError['error']['code'], message: string, headers = {}) => {
    if (status !== 503) (options.log ?? ((entry) => console.info(JSON.stringify(entry))))({
      event: 'chat', latencyMs: Date.now() - started, mode: 'error', category: code, model: null, snapshotId: null,
    });
    return json({ error: { code, message } } satisfies ChatError, status, headers);
  };
  const url = new URL(request.url);
  if (url.pathname !== '/api/chat') return error(404, 'not_found', 'Hindi makita ang API. API not found.');
  if (request.method !== 'POST') return error(405, 'method_not_allowed', 'Gamitin ang POST. Use POST.', { Allow: 'POST' });
  const origin = request.headers.get('origin');
  if ((origin !== null && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return error(400, 'invalid_request', 'Gamitin ang chat sa portal na ito. Use chat on this portal.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) return error(400, 'invalid_request', 'Invalid Content-Length.');
  if (Number(declared) > 8192) return error(413, 'payload_too_large', 'Masyadong mahaba ang mensahe. Request exceeds 8 KB.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || !['identity', null].includes(request.headers.get('content-encoding'))) return error(400, 'invalid_request', 'Magpadala ng JSON. Send uncompressed application/json.');
  let value: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return error(400, 'invalid_request', 'Walang tanong. A question is required.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 8192) {
          void reader.cancel().catch(() => {});
          return error(413, 'payload_too_large', 'Masyadong mahaba ang mensahe. Request exceeds 8 KB.');
        }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    return error(400, 'invalid_request', 'Hindi mabasa ang tanong. Invalid JSON request.');
  }
  if (!validRequest(value)) return error(400, 'invalid_request', 'Suriin ang tanong (hanggang 500 character), wika, at konteksto. Check question, language and context.');
  try {
    return json(await answerChat(value, options));
  } catch {
    return error(503, 'unavailable', 'Hindi muna mabasa ang mga tala. Subukan muli mamaya; maaari pa ring gamitin ang portal. Records are temporarily unavailable; you can still browse the portal.');
  }
}

export default { fetch: (request: Request) => handleChat(request) };
