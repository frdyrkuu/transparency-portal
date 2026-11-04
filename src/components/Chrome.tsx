import { useMemo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { KIND_LABELS, shortNameOf } from '../config';
import { usePortal } from '../lib/portal-context';
import { date } from '../lib/format';
import { NATIONAL_URL, SOURCE_CODE_URL } from '../lib/links';

const BETTERGOV_LOGO = '/brand/bettergov-horizontal-primary.png';

const NAV = [
  { to: '/', hash: '', label: '2027 projects' },
  { to: '/', hash: '#offices', label: 'Offices and districts' },
  { to: '/gaa', hash: '', label: 'Budgets 2020–2026' },
  { to: '/about', hash: '', label: 'About the data' },
];

export function Masthead() {
  const { config, client } = usePortal();
  const { pathname, hash } = useLocation();
  const today = useMemo(
    () => new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    [],
  );
  return (
    <>
    {config.buildYourOwnStrip !== false && (
      // Above the masthead, so it scrolls away; a plain link to the source.
      <a className="build-strip" href={SOURCE_CODE_URL} target="_blank" rel="noopener">
        <span className="build-strip-title">Create your own transparency portal</span>
        <span className="build-strip-url">
          {SOURCE_CODE_URL.replace(/^https:\/\//, '')} <span aria-hidden="true">→</span>
        </span>
      </a>
    )}
    <header className="masthead">
      <div className="masthead-top">
        <div className="page masthead-top-inner">
          <span className="muted">{today}</span>
          <span className="masthead-links">
            <a href={NATIONAL_URL} target="_blank" rel="noopener">
              National picture <span aria-hidden="true">↗</span>
            </a>
            <a href={`${client.base}/docs`} target="_blank" rel="noopener">
              API <span aria-hidden="true">↗</span>
            </a>
            <a href={SOURCE_CODE_URL} target="_blank" rel="noopener">
              Build your own <span aria-hidden="true">↗</span>
            </a>
          </span>
        </div>
      </div>
      <div className="page masthead-main">
        <Link to="/" className="masthead-title">
          {config.logo && <img src={config.logo} alt="" className="masthead-logo" />}
          <span>
            <span className="masthead-kicker">
              {KIND_LABELS[config.kind]} <span aria-hidden="true">·</span> Budgets 2020–2027
            </span>
            <span className="masthead-name">{config.name}</span>
          </span>
        </Link>
        <a className="masthead-with" href="https://bettergov.ph" target="_blank" rel="noopener">
          <span className="label">Data from</span>
          <img src={BETTERGOV_LOGO} alt="BetterGov.ph" width="128" height="28" />
        </a>
      </div>
      <nav className="subnav" aria-label="Sections">
        <div className="page subnav-inner">
          {NAV.filter((n) => n.hash !== '#offices' || config.scope.offices?.length || config.scope.districts?.length).map((n) => {
            const active = pathname === n.to && (n.hash ? hash === n.hash : hash !== '#offices');
            return (
              <Link
                key={n.label}
                to={{ pathname: n.to, hash: n.hash }}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}
                // "Projects" from further down the same page goes back to the top.
                onClick={() => !n.hash && pathname === n.to && window.scrollTo(0, 0)}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
    </>
  );
}

export function Footer() {
  const { config, scope, client } = usePortal();
  const meta = scope.status === 'ready' ? scope.value.meta : null;
  return (
    <footer className="footer">
      <div className="page footer-inner">
        <p className="footer-source">
          Source: NEP FY 2027 and House Bill 10858 · via the BetterGov.ph Budget API
          {meta && <> · data built {date(meta.built_at)}</>}
        </p>
        {meta && <p className="footer-notice">{meta.notice}</p>}
        <ul className="footer-links">
          <li>
            <span className="label">This portal</span>
            <span>
              {shortNameOf(config)}, run by{' '}
              {config.operator.url ? (
                <a href={config.operator.url} target="_blank" rel="noopener">{config.operator.name}</a>
              ) : (
                config.operator.name
              )}
              {config.operator.email && (
                <> · <a href={`mailto:${config.operator.email}`}>{config.operator.email}</a></>
              )}
            </span>
          </li>
          <li>
            <span className="label">Every project, nationwide</span>
            <a href={NATIONAL_URL} target="_blank" rel="noopener">budget.bettergov.ph ↗</a>
          </li>
          <li>
            <span className="label">Data</span>
            <a href={`${client.base}/docs`} target="_blank" rel="noopener">Budget API and MCP ↗</a>
          </li>
          <li>
            <span className="label">Open source</span>
            <a href={SOURCE_CODE_URL} target="_blank" rel="noopener">Fork this portal for your LGU or DPWH office ↗</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children && <div className="lede">{children}</div>}
    </div>
  );
}
