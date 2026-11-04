/** Refresh scoped FY2027 summary questions using the same API/resolver as the dashboard. */
import assert from 'node:assert/strict';
import config from '../portal.config.ts';
import { antipoloScope, validateProject } from '../scripts/build-rag.ts';
import { createClient, type Client } from '../src/api/client.ts';
import { resolveScope } from '../src/lib/scope.ts';
import { loadSnapshot, retrieve, type RagRequest } from './rag.ts';

export async function retrieveWithApi(request: RagRequest, send: typeof fetch = fetch) {
  const reference = await retrieve(request);
  if (!reference.refreshProjects) return reference;
  try {
    antipoloScope(config); // The browser/question cannot broaden the city or supply API URLs.
    const snapshot = await loadSnapshot();
    const signal = AbortSignal.timeout(8_000);
    const client = createClient(snapshot.manifest.apiBase, (url, init) => send(url, { ...init, signal, redirect: 'error' }));
    let version: string | undefined;
    const checked: Client = { ...client, allProjects: async (dataset, params) => {
      const result = await client.allProjects(dataset, params);
      const meta = result.list.meta;
      assert.equal(meta.dataset, 'hgab');
      assert.equal(meta.fiscal_year, 2027);
      assert.equal(meta.currency, 'PHP');
      assert.equal(meta.scale, 'pesos');
      const current = JSON.stringify([meta.source_commit, meta.built_at]);
      if (version === undefined) version = current;
      assert.equal(current, version, 'Source changed during collection');
      assert.ok(!result.truncated && Number.isSafeInteger(result.list.data.total) && result.list.data.total >= 0
        && result.rows.length === result.list.data.total, 'Incomplete project query');
      assert.equal(new Set(result.rows.map((row) => row.id)).size, result.rows.length, 'Duplicate project IDs');
      for (const row of result.rows) validateProject(row, dataset, client.base);
      return result;
    } };
    const scope = await resolveScope(checked, config);
    assert.equal(scope.meta.fiscal_year, 2027);
    assert.equal(scope.meta.currency, 'PHP');
    assert.equal(scope.meta.scale, 'pesos');
    assert.ok(typeof scope.meta.source_commit === 'string' && scope.meta.source_commit.length > 0 && Number.isFinite(Date.parse(scope.meta.built_at)));
    const live = await retrieve(request, snapshot, { scope, collectedAt: new Date().toISOString() });
    return live;
  } catch {
    // Keep the last reviewed data useful, without claiming a failed/partial refresh is current.
    return { ...reference, answer: `${request.language === 'en'
      ? 'I could not check the latest records just now. This answer uses our previously collected data, dated below.'
      : 'Paumanhin po, hindi ko muna makuha ang pinakabagong tala. Ang sagot po ay mula sa dati nang nakuhang datos; nasa ibaba ang petsa nito.'}\n\n${reference.answer}` };
  }
}
