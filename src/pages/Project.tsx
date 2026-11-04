import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { Envelope, ProjectDetail, Version } from '../api/types';
import { DATASET_KEYS, shortNameOf, type DatasetKey } from '../config';
import { Await, Disclaimers, External, ReasonTags, StatusChip } from '../components/Bits';
import { phpDelta, phpFull } from '../lib/format';
import { usePortal, type Async } from '../lib/portal-context';
import { projectKey } from '../lib/scope';
import { reportHref } from '../lib/report';
import { useTitle } from '../lib/use-title';

const VERSIONS: Version[] = ['nep', 'hgab2', 'hgab3', 'api'];
const FALLBACK_VERSION_LABELS: Record<Version, string> = {
  nep: 'NEP',
  hgab2: 'House bill, second reading',
  hgab3: 'House bill, third reading',
  api: 'DPWH transparency website listing',
};

export default function Project({ onExplain }: { onExplain: (key: string) => void }) {
  const { dataset = '', id = '' } = useParams();
  const { client, scope, config } = usePortal();
  const valid = (DATASET_KEYS as readonly string[]).includes(dataset);
  const inScope = scope.status === 'ready' && scope.value.projects.some((p) => p.key === projectKey(dataset, id));
  const [state, setState] = useState<{ key: string; value: Async<Envelope<ProjectDetail>> } | null>(null);
  const key = `${dataset}/${id}`;

  useEffect(() => {
    if (!valid || !inScope) return;
    let live = true;
    client.project(dataset as DatasetKey, id).then(
      (value) => live && setState({ key, value: { status: 'ready', value } }),
      (error) => live && setState({ key, value: { status: 'error', error: error instanceof Error ? error : new Error(String(error)) } }),
    );
    return () => {
      live = false;
    };
  }, [client, dataset, id, key, valid, inScope]);

  if (!valid) {
    return (
      <main className="page main">
        <p className="state">There is no program called “{dataset}”. <Link to="/">Back to every project</Link></p>
      </main>
    );
  }
  const current: Async<Envelope<ProjectDetail>> = state?.key === key ? state.value : { status: 'loading' };
  return (
    <main className="page main">
      <p className="crumbs"><Link to="/">← Every project</Link></p>
      <Await state={scope} what="the portal’s projects">
        {() => inScope ? (
          <Await state={current} what="the project">
            {(env) => <ProjectView env={env} onExplain={onExplain} />}
          </Await>
        ) : (
          <p className="state">This project is outside the scope of {shortNameOf(config)}. <Link to="/">Back to every project</Link></p>
        )}
      </Await>
    </main>
  );
}

function ProjectView({ env, onExplain }: { env: Envelope<ProjectDetail>; onExplain: (key: string) => void }) {
  const { config, overview, scope, client } = usePortal();
  const location = useLocation();
  const p = env.data;
  useTitle(`${p.title} · ${shortNameOf(config)}`);

  const ov = overview.status === 'ready' ? overview.value.data : null;
  const program = ov?.datasets.find((d) => d.key === p.dataset);
  const versionLabel = (v: Version) => ov?.record_versions.find((r) => r.key === v)?.label ?? FALLBACK_VERSION_LABELS[v];
  const inScope = scope.status === 'ready' ? scope.value.projects.find((x) => x.key === projectKey(p.dataset, p.id)) : undefined;
  const versions = VERSIONS.filter((v) => v !== 'api' || p.dataset === 'dpwh');
  const report = reportHref(config, p, window.location.origin + location.pathname);

  const details: [string, string | null][] = [
    ['Program', program?.label ?? p.dataset.toUpperCase()],
    ['Program line', p.program],
    ['Sub-line', p.pap],
    ['DPWH office', p.office],
    ['Region', p.region],
    ['How the two versions were matched', p.labels.match?.label ?? null],
    ['Between the House readings', p.labels.reading?.label ?? null],
    ['DPWH transparency website', p.labels.dpwh_site?.label ?? null],
    ['Length', p.length_m != null ? `${Math.round(p.length_m).toLocaleString('en-US')} m` : null],
  ];

  return (
    <article className="project">
      <p className="eyebrow">
        {program?.short ?? p.dataset.toUpperCase()}<span className="sep">·</span>FY 2027
        {p.office && <><span className="sep">·</span>{p.office}</>}
      </p>
      <h1 className="project-h">{p.title}</h1>
      <div className="project-status">
        <StatusChip group={p.bridge_group} label={p.status_label} held={p.held} />
        {p.labels.status.help && <p className="muted">{p.labels.status.help}</p>}
      </div>

      <button type="button" className="button button-primary chat-open" aria-haspopup="dialog" onClick={() => onExplain(projectKey(p.dataset, p.id))}>
        Ipaliwanag ang proyektong ito
      </button>

      <div className="project-grid">
        <section aria-labelledby="amounts-h">
          <h2 id="amounts-h" className="section-h">Amount in each version, with the page it is on</h2>
          <table className="amounts">
            <tbody>
              {versions.map((v) => {
                const amount = p[`${v}_php` as const];
                const pdf = p.pdf_url[v];
                const page = v === 'api' ? null : p[`${v}_page` as const];
                return (
                  <tr key={v}>
                    <th scope="row">{versionLabel(v)}</th>
                    <td className="num r" title={phpFull(amount)}>{amount == null ? <span className="muted">not listed</span> : phpFull(amount)}</td>
                    <td className="r">
                      {pdf ? <External href={pdf}>{page ? `Page ${page}` : 'Open the document'}</External> : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
              <tr className="amounts-total">
                <th scope="row">Change, House bill against the NEP</th>
                <td className="num r">{phpDelta(p.delta_php)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="fine">
            The NEP and the House bill are two versions of one budget, so the amounts are compared, never added. Open the
            page to check the figure against the document itself.
          </p>

          {p.labels.flags.length > 0 && (
            <>
              <h3 className="sub-h">Notes on this line</h3>
              <ul className="flags">
                {p.labels.flags.map((f) => <li key={f.code}>{f.label}{f.help ? <span className="muted"> {f.help}</span> : null}</li>)}
              </ul>
            </>
          )}
        </section>

        <aside className="project-side">
          <dl className="details">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}>
                <dt className="label">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {p.lat != null && p.lon != null && (
              <div>
                <dt className="label">Coordinates in the document</dt>
                <dd>
                  <External href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=15/${p.lat}/${p.lon}`}>
                    {p.lat.toFixed(5)}, {p.lon.toFixed(5)} on the map
                  </External>
                </dd>
              </div>
            )}
            <div>
              <dt className="label">Why it is in this portal</dt>
              <dd>
                {inScope && <ReasonTags reasons={inScope.reasons} />}
              </dd>
            </div>
          </dl>

          <div className="report">
            <p className="label">Seen this project on the ground?</p>
            {report ? (
              <a className="button button-primary" href={report}>Report on this project ↗</a>
            ) : (
              <p className="small">
                Citizen reports will go to one place for every portal, budget.bettergov.ph. Reporting is not open yet.
              </p>
            )}
          </div>

          <p className="small links">
            <External href={p.url}>This project on budget.bettergov.ph</External>
            <br />
            <External href={client.href(p.api_url)}>The API record (JSON)</External>
          </p>
        </aside>
      </div>

      <Disclaimers items={env.disclaimers} />
    </article>
  );
}
