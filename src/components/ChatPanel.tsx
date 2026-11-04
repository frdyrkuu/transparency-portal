import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { ChatRequest, ChatResponse, Language } from '../api/chat-types';
import { phpFull } from '../lib/format';

export interface ChatPanelHandle { open(projectKey?: string): void }
interface Exchange { user: string; response: ChatResponse; language: Language }

const COPY = {
  fil: {
    title: 'Magtanong tungkol sa budget', close: 'Isara', language: 'Wika / Language',
    assistant: 'Gabay sa budget', welcome: 'Ano po ang nais ninyong malaman?',
    welcomeHelp: 'Maaari po kayong magtanong sa Filipino o English. Tutulungan ko po kayong unawain ang mga budget at proyekto sa Antipolo.',
    placeholder: 'Isulat po ang inyong tanong dito…', privacyTitle: 'Tungkol sa inyong usapan',
    privacyShort: 'Huwag po tayong maglagay ng personal o sensitibong impormasyon.',
    thinking: 'Sinusuri po ang inyong tanong…', patience: 'Salamat po sa paghihintay. Sinusuri pa ang mga tala para sa inyong tanong.',
    latest: '↓ Pinakabagong mensahe', followUp: 'Maaari po kayong magtanong pa tungkol sa sagot.',
    intro: 'Mga tala ng pambansang budget na may pangalang Antipolo. Hindi ito ang buong budget ng City Hall.',
    privacy: 'Kapag ginamit ang AI na paliwanag, ipapadala sa Google Gemini ang iyong tanong at kaugnay na konteksto. Maaaring gamitin ang mga ito para mapahusay ang mga serbisyo at masuri ng tao, ayon sa mga tuntunin ng Google. Huwag maglagay ng personal o sensitibong impormasyon. Hindi iniimbak ng portal ang usapan; mawawala ito kapag ni-reload o sinimulan ang bagong usapan.',
    terms: 'Mga tuntunin ng Google Gemini', suggestions: 'Mga mungkahing tanong',
    questions: ['Ilang proyekto sa Antipolo?', 'Magkano ang budget sa Antipolo?', 'Ano ang ibig sabihin ng NEP?'],
    explain: 'Ipaliwanag ang proyektong ito.', selected: 'Tungkol po ito sa proyektong inyong binuksan.',
    question: 'Inyong tanong', limit: 'Enter para ipadala · Shift + Enter para sa bagong linya',
    send: 'Ipadala', waiting: 'Hinahanap ang mga tala at inihahanda ang sagot…', ready: 'Handa na ang sagot.',
    newChat: 'Bagong usapan', cleared: 'Nagsimula ang bagong usapan.', simpler: 'Mas simpleng paliwanag',
    simpleQuestion: 'Mas simpleng paliwanag.', you: 'Ikaw',
    modes: { ai: 'AI na paliwanag', reference: 'Sagot mula sa mga tala', clarification: 'Kailangan ng paglilinaw', no_data: 'Walang sapat na tala' },
    unavailable: 'Narito po ang impormasyong mula sa mga tala at dokumento.',
    network: 'Paumanhin po, hindi maipadala ang inyong tanong. Pakisuri po ang koneksyon at subukang muli.',
    service: 'Paumanhin po, hindi muna available ang sagot. Maaari po ninyong subukang muli mamaya o magbasa muna sa portal.',
    throttled: 'Marami pong tanong sa ngayon. Maghintay po ng isang minuto bago subukang muli.',
    retry: 'Subukang muli', facts: 'Mga bilang mula sa tala', missing: 'Hindi nakalista', partial: 'Bahagyang kabuuan; may kulang na halaga:',
    sources: 'Mga sanggunian', page: 'Pahina', collected: 'Datos na nakuha noong',
    freshness: 'Maaaring may mas bagong datos. Ang petsa sa itaas po ang huling pagkuha ng mga talang ito.',
    stale: 'Mahigit isang linggo na po ang kopyang ito ng datos. Maaaring may mas bagong tala.',
    projects: 'Mga proyektong nakita', showing: 'Ipinapakita po ang', of: 'sa', matches: 'katugmang proyekto',
    document: 'Orihinal na dokumento', recordNote: 'Ang mga pangalan at halaga po ay mula sa mga pampublikong tala ng budget.',
    records: 'proyekto', families: 'grupo ng magkakaugnay na programa', current: 'Pareho ang pinagkunan ng mga bilang dito at sa portal.',
  },
  en: {
    title: 'Ask about the budget', close: 'Close', language: 'Wika / Language',
    assistant: 'Budget guide', welcome: 'What would you like to know?',
    welcomeHelp: 'Ask in Filipino or English. I can help you understand the budgets and projects in Antipolo.',
    placeholder: 'Type your question here…', privacyTitle: 'About your conversation',
    privacyShort: 'Do not include personal or sensitive information.',
    thinking: 'Thinking…', patience: 'Thank you for waiting. The records for your question are still being checked.',
    latest: '↓ Latest message', followUp: 'You can ask a follow-up about the answer.',
    intro: 'National budget records naming Antipolo. This is not the complete City Hall budget.',
    privacy: 'When you use an AI explanation, your question and relevant context are sent to Google Gemini. They may be used to improve services and reviewed by people under Google’s terms. Do not include personal or sensitive information. The portal does not save conversations; reloading or starting a new conversation clears them.',
    terms: 'Google Gemini terms', suggestions: 'Suggested questions',
    questions: ['How many projects are in Antipolo?', 'How much is the budget for Antipolo?', 'What is NEP?'],
    explain: 'Explain this project.', selected: 'About the project you opened.', question: 'Your question',
    limit: 'Enter to send · Shift + Enter for a new line',
    send: 'Send', waiting: 'Finding records and preparing the answer…', ready: 'The answer is ready.',
    newChat: 'New conversation', cleared: 'Started a new conversation.', simpler: 'Simpler explanation',
    simpleQuestion: 'Simpler explanation.', you: 'You',
    modes: { ai: 'AI explanation', reference: 'Reference answer', clarification: 'Clarification needed', no_data: 'No supporting records' },
    unavailable: 'Here is the information from the records and documents.',
    network: 'Your question could not be sent. Check your connection and try again.',
    service: 'Answers are temporarily unavailable. Try again later; you can still browse the portal.',
    throttled: 'There are too many questions right now. Wait a minute before trying again.',
    retry: 'Try again', facts: 'Figures from the records', missing: 'Not listed', partial: 'Partial total; missing amounts:',
    sources: 'Sources', page: 'Page', collected: 'Data collected on',
    freshness: 'There may be newer information. Check the sources for updates.',
    stale: 'This copy of the data is over a week old. Check the sources for updates.',
    projects: 'Matching projects', showing: 'Showing', of: 'of', matches: 'matching projects',
    document: 'Original document', recordNote: 'Names and amounts are from public budget records.',
    records: 'projects', families: 'groups of related programs', current: 'These figures use the same sources as the rest of the portal.',
  },
};

const STAGES = {
  nep: 'NEP', house: 'House bill', hgab2: 'House bill · second reading', hgab3: 'House bill · third reading',
  api: 'DPWH transparency listing', gaa: 'GAA', 'house-minus-nep': 'House − NEP', all: 'NEP / House',
};
const STAGE_LABELS = {
  fil: { nep: 'Panukala ng Pangulo (NEP)', house: 'Panukala ng Kamara (House bill)', hgab2: 'Panukala ng Kamara · ikalawang pagbasa', hgab3: 'Panukala ng Kamara · ikatlong pagbasa', gaa: 'Nakapasa nang budget (GAA)', api: 'Nakalista sa DPWH' },
  en: { nep: 'President’s proposal (NEP)', house: 'House proposal (House bill)', hgab2: 'House proposal · second reading', hgab3: 'House proposal · third reading', gaa: 'Enacted budget (GAA)', api: 'DPWH listing' },
};

// Only same-origin API output supplies links. Refuse executable URL schemes even on a bad response.
function sourceUrl(url: string) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
}

function isResponse(value: unknown): value is ChatResponse {
  if (!value || typeof value !== 'object') return false;
  const r = value as ChatResponse;
  return ['ai', 'reference', 'clarification', 'no_data'].includes(r.mode) && typeof r.answer === 'string'
    && Array.isArray(r.facts) && r.facts.every((f) => f && typeof f.id === 'string' && typeof f.label === 'string'
      && (f.value === null || Number.isSafeInteger(f.value)) && ['PHP', 'records', 'families'].includes(f.unit)
      && Object.hasOwn(STAGES, f.stage) && Number.isInteger(f.year) && Number.isInteger(f.missingCount)
      && Array.isArray(f.sourceIds) && f.sourceIds.every((id) => typeof id === 'string'))
    && Array.isArray(r.records) && r.records.every((record) => record && typeof record.key === 'string'
      && typeof record.title === 'string' && typeof record.department === 'string' && Array.isArray(record.amounts)
      && record.amounts.every((amount) => amount && Number.isInteger(amount.year) && Object.hasOwn(STAGE_LABELS.en, amount.stage)
        && (amount.value === null || Number.isSafeInteger(amount.value))))
    && Array.isArray(r.sources) && r.sources.every((s) => s && typeof s.id === 'string' && typeof s.title === 'string'
      && typeof s.url === 'string' && sourceUrl(s.url) && (s.page === undefined || Number.isInteger(s.page)))
    && !!r.snapshot && typeof r.snapshot.id === 'string' && typeof r.snapshot.collectedAt === 'string'
    && Number.isFinite(Date.parse(r.snapshot.collectedAt)) && typeof r.snapshot.stale === 'boolean' && typeof r.snapshot.notice === 'string'
    && !!r.provenance && Number.isInteger(r.provenance.matchedCount) && typeof r.provenance.coverage === 'string'
    && !!r.provenance.filter && (r.provenance.filter.projectKey === null || typeof r.provenance.filter.projectKey === 'string');
}

export default function ChatPanel({ ref }: { ref: Ref<ChatPanelHandle> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const active = useRef<AbortController | null>(null);
  const [language, setLanguage] = useState<Language>('fil');
  const [project, setProject] = useState<string>();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [outgoing, setOutgoing] = useState<{ user: string; language: Language } | null>(null);
  const [longWait, setLongWait] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [error, setError] = useState<'network' | 'service' | 'throttled' | null>(null);
  const [failedQuestion, setFailedQuestion] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const text = COPY[language];

  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setLongWait(true), 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (followLatest.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  }, [outgoing, pending, error, longWait]);

  useEffect(() => {
    const node = messages.current;
    const turn = node?.querySelector('.chat-conversation > li:last-child');
    if (followLatest.current && node && turn) {
      node.scrollTop += turn.getBoundingClientRect().top - node.getBoundingClientRect().top - 24;
    }
  }, [exchanges]);

  function cancel() {
    if (active.current && outgoing) setDraft(outgoing.user);
    active.current?.abort();
    active.current = null;
    setPending(false);
    setOutgoing(null);
  }

  useImperativeHandle(ref, () => ({
    open(projectKey) {
      if (projectKey) {
        cancel();
        setProject(projectKey);
        setExchanges([]);
        setError(null);
        setAnnouncement('');
        setDraft(COPY[language].explain);
      }
      followLatest.current = true;
      setShowLatest(false);
      dialog.current?.showModal();
    },
  }));

  function newConversation() {
    cancel();
    setProject(undefined);
    setExchanges([]);
    setDraft('');
    setError(null);
    setFailedQuestion('');
    setAnnouncement(text.cleared);
    followLatest.current = true;
    setShowLatest(false);
    input.current?.focus();
  }

  async function send(question: string) {
    const message = question.trim();
    if (active.current || !message || message.length > 500) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setOutgoing({ user: message, language });
    setLongWait(false);
    followLatest.current = true;
    setShowLatest(false);
    setError(null);
    setAnnouncement('');
    setDraft('');
    const history = exchanges.slice(-2).map((e) => ({ user: e.user.slice(0, 500), assistant: e.response.answer.slice(0, 500) }));
    const request: ChatRequest = { message, language, ...(project ? { context: { projectKey: project } } : {}), history };
    // Keep multibyte history inside the endpoint's 8 KB bound as well as its two-exchange limit.
    while (new TextEncoder().encode(JSON.stringify(request)).length > 8192 && history.length) history.shift();
    let failure: 'network' | 'service' | 'throttled' = 'network';
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request), signal: controller.signal, cache: 'no-store', redirect: 'error',
      });
      failure = response.status === 429 ? 'throttled' : 'service';
      if (!response.ok) throw new Error('Chat unavailable');
      const result: unknown = await response.json();
      if (!isResponse(result)) throw new Error('Invalid chat response');
      if (active.current !== controller) return;
      setExchanges((previous) => [...previous, { user: message, response: result, language }]);
      setOutgoing(null);
      setProject(result.provenance.filter.projectKey ?? undefined);
      setDraft('');
      setAnnouncement(text.ready);
    } catch {
      if (active.current !== controller) return;
      setError(failure);
      setFailedQuestion(message);
      setDraft(message);
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }

  return (
    <dialog ref={dialog} id="budget-chat" className="chat-panel" aria-labelledby="chat-title" lang={language} onClose={cancel}>
      <header className="chat-top">
        <div className="chat-header">
          <div><h2 id="chat-title">{text.title}</h2><p>{text.assistant} · Antipolo</p></div>
          <button type="button" className="chat-close" onClick={() => dialog.current?.close()}>{text.close} <span aria-hidden="true">×</span></button>
        </div>
        <div className="chat-actions">
        <label><span className="sr-only">{text.language}</span>
          <select value={language} disabled={pending} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="fil">Filipino</option><option value="en">English</option>
          </select>
        </label>
        <button type="button" onClick={newConversation}>{text.newChat}</button>
        </div>
      </header>
      <div className="chat-message-area">
      <div ref={messages} className="chat-messages" tabIndex={0} role="region" aria-label={language === 'fil' ? 'Mga mensahe' : 'Messages'} onScroll={() => {
        const node = messages.current!;
        followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        setShowLatest(!followLatest.current);
      }}>
      {exchanges.length === 0 && !outgoing && <section className="chat-welcome">
        <h3>{text.welcome}</h3>
        <p>{text.welcomeHelp}</p>
        <p className="chat-scope">{text.intro}</p>
        <section aria-label={text.suggestions} className="chat-suggestions">
        {text.questions.map((question) => (
          <button type="button" key={question} disabled={pending} onClick={() => { setDraft(question); input.current?.focus(); }}>{question}</button>
        ))}
        </section>
      </section>}
      {project && <p className="chat-context">{text.selected}</p>}
      <ol className="chat-conversation" aria-label={language === 'fil' ? 'Usapan' : 'Conversation'}>
        {exchanges.map((exchange, index) => (
          <li key={index} lang={exchange.language}>
            <p className="chat-question"><span className="sr-only">{COPY[exchange.language].you}: </span>{exchange.user}</p>
            <Answer response={exchange.response} language={exchange.language} turn={index} />
          </li>
        ))}
      </ol>
      {outgoing && <div className="chat-outgoing" lang={outgoing.language}>
        <p className="chat-question"><span className="sr-only">{COPY[outgoing.language].you}: </span>{outgoing.user}</p>
      </div>}
      <div role="status" aria-live="polite" aria-atomic="true" className={pending ? 'chat-status chat-thinking' : 'sr-only'}>
        {pending ? <><span className="chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span><div><strong>{text.thinking}</strong><p>{longWait ? text.patience : text.waiting}</p></div></> : announcement}
      </div>
      {exchanges.length > 0 && !pending && !error && <div className="chat-follow-up">
        <button type="button" onClick={() => void send(project ? text.simpleQuestion
          : `${exchanges.at(-1)!.user.slice(0, 499 - text.simpleQuestion.length)} ${text.simpleQuestion}`)}>{text.simpler}</button>
      </div>}
      {error && <div className="chat-error" role="alert">
        <p>{text[error]}</p>
        <button type="button" disabled={pending} onClick={() => void send(failedQuestion)}>{text.retry}</button>
      </div>}
      </div>
      {showLatest && <button className="chat-latest" type="button" onClick={() => {
        followLatest.current = true;
        setShowLatest(false);
        if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
      }}>{text.latest}</button>}
      </div>
      <section className="chat-bottom" aria-label={text.question}>
      <form onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <label htmlFor="chat-question">{text.question}</label>
        <div className="chat-compose">
          <textarea ref={input} id="chat-question" value={draft} maxLength={500} rows={2} required readOnly={pending}
            placeholder={text.placeholder} aria-describedby="chat-limit" onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft);
              }
            }} />
          <button className="chat-send" type="submit" aria-disabled={pending || !draft.trim()}>{text.send} <span aria-hidden="true">↑</span></button>
        </div>
        <div id="chat-limit" className="chat-compose-help"><span>{text.limit}</span><span>{draft.length}/500</span></div>
      </form>
      <div className="chat-privacy-row">
      <details className="chat-privacy">
        <summary>{text.privacyTitle}</summary>
        <p>{text.privacy}{' '}<a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">{text.terms} ↗</a></p>
      </details>
      <p className="chat-privacy-short">{text.privacyShort}</p>
      </div>
      </section>
    </dialog>
  );
}

function Answer({ response: r, language, turn }: { response: ChatResponse; language: Language; turn: number }) {
  const text = COPY[language];
  const sources = r.sources.filter((source) => !/(?:^|\/)api(?:\/|$)|\.json$/i.test(new URL(source.url).pathname));
  const recordKeys = new Set(r.records.map((record) => record.key));
  const facts = r.facts.filter((fact) => !fact.recordKey || !recordKeys.has(fact.recordKey));
  return <article className="chat-answer" aria-label={text.modes[r.mode]}>
    <h3 className="chat-assistant-name">{text.assistant}</h3>
    {r.aiUnavailable && <p className="chat-reference-note">{text.unavailable}</p>}
    <div className="chat-prose">{r.answer.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    {r.records.length > 0 && <section className="chat-records" aria-label={text.projects}>
      <h4>{text.projects}</h4>
      {r.provenance.matchedCount > r.records.length && <p className="chat-record-count">{text.showing} {r.records.length} {text.of} {r.provenance.matchedCount} {text.matches}.</p>}
      {r.records.map((record) => <article key={record.key} className="chat-record">
        <h5>{record.title}</h5>
        <p className="chat-record-department">{record.department}</p>
        <dl className="chat-facts chat-record-amounts">
          {record.amounts.map((amount) => <div key={`${amount.year}-${amount.stage}`}>
            <dt>{STAGE_LABELS[language][amount.stage]} · {amount.year}</dt>
            <dd><strong>{amount.value === null ? text.missing : phpFull(amount.value)}</strong></dd>
          </div>)}
          {r.facts.filter((fact) => fact.recordKey === record.key && fact.kind === 'difference').map((fact) => <div key={fact.id}>
            <dt>{fact.label} · {fact.year}</dt>
            <dd><strong>{fact.value === null ? text.missing : phpFull(fact.value)}</strong></dd>
          </div>)}
        </dl>
      </article>)}
    </section>}
    {facts.length > 0 && <section aria-label={text.facts}>
      <h4>{text.facts}</h4>
      <dl className="chat-facts">
        {facts.map((fact) => <div key={fact.id}>
          <dt>{fact.label} · {fact.year}{fact.stage === 'all' || fact.label.toLowerCase().includes(STAGES[fact.stage].toLowerCase()) ? '' : ` · ${STAGES[fact.stage]}`}</dt>
          <dd>
            <strong>{fact.value === null ? text.missing : fact.unit === 'PHP' ? phpFull(fact.value) : `${fact.value.toLocaleString(language === 'fil' ? 'fil-PH' : 'en-PH')} ${text[fact.unit]}`}</strong>
            {fact.missingCount > 0 && fact.value !== null && <p>{text.partial} {fact.missingCount}</p>}
            {sources.length > 0 && <span className="chat-fact-sources"><a href={`#chat-sources-${turn}`}>{text.sources}</a></span>}
          </dd>
        </div>)}
      </dl>
    </section>}
    {(r.records.length > 0 || facts.length > 0) && <p className="chat-record-note">{text.recordNote}</p>}
    {sources.length > 0 && <section id={`chat-sources-${turn}`} aria-label={text.sources}>
      <h4>{text.sources}</h4>
      <ol className="chat-sources">
        {sources.map((source, index) => <li key={source.id} id={`chat-source-${turn}-${index}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{text.document} {index + 1}{source.page !== undefined ? ` · ${text.page} ${source.page}` : ''} ↗</a>
        </li>)}
      </ol>
    </section>}
    <div className="chat-snapshot">
      <p>{text.collected} <time dateTime={r.snapshot.collectedAt}>{new Date(r.snapshot.collectedAt).toLocaleDateString(language === 'fil' ? 'fil-PH' : 'en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' })}</time>.</p>
      <p className={r.snapshot.stale ? 'chat-notice' : undefined}>{r.snapshot.live ? text.current : r.snapshot.stale ? text.stale : text.freshness}</p>
    </div>
  </article>;
}
