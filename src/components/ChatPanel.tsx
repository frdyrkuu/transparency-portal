import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { ChatRequest, ChatResponse, Language } from '../api/chat-types';
import { date, php, phpFull } from '../lib/format';

export interface ChatPanelHandle { open(projectKey?: string): void }
interface Exchange { user: string; response: ChatResponse; language: Language }

const COPY = {
  fil: {
    title: 'Magtanong tungkol sa budget', close: 'Isara', language: 'Wika / Language',
    intro: 'Mga tala ng pambansang budget na may pangalang Antipolo. Hindi ito ang buong budget ng City Hall.',
    privacy: 'Kapag ginamit ang AI na paliwanag, ipapadala sa Google Gemini ang iyong tanong at kaugnay na konteksto. Maaaring gamitin ang mga ito para mapahusay ang mga serbisyo at masuri ng tao, ayon sa mga tuntunin ng Google. Huwag maglagay ng personal o sensitibong impormasyon. Hindi iniimbak ng portal ang usapan; mawawala ito kapag ni-reload o sinimulan ang bagong usapan.',
    terms: 'Mga tuntunin ng Google Gemini', suggestions: 'Mga mungkahing tanong',
    questions: ['Ano ang ibig sabihin ng NEP?', 'May nakalistang kalsada sa Mayamot sa 2027?', 'Ano ang pinagkaiba ng NEP at GAA?'],
    explain: 'Ipaliwanag ang proyektong ito.', selected: 'Napiling proyekto',
    question: 'Iyong tanong', limit: 'Hanggang 500 karakter. Enter para sa bagong linya; pindutin ang Ipadala para magtanong.',
    send: 'Ipadala', waiting: 'Hinahanap ang mga tala at inihahanda ang sagot…', ready: 'Handa na ang sagot.',
    newChat: 'Bagong usapan', cleared: 'Nagsimula ang bagong usapan.', simpler: 'Mas simpleng paliwanag',
    simpleQuestion: 'Mas simpleng paliwanag.', you: 'Ikaw',
    modes: { ai: 'AI na paliwanag', reference: 'Sagot mula sa mga tala', clarification: 'Kailangan ng paglilinaw', no_data: 'Walang sapat na tala' },
    unavailable: 'Hindi muna available ang AI na paliwanag. Magagamit pa rin ang mga tala at sanggunian.',
    network: 'Hindi maipadala ang tanong. Suriin ang koneksyon at subukang muli.',
    service: 'Hindi muna available ang sagot. Subukang muli mamaya; maaari pa ring magbasa sa portal.',
    throttled: 'Maraming tanong sa ngayon. Maghintay ng isang minuto bago subukang muli.',
    retry: 'Subukang muli', facts: 'Mga bilang mula sa tala', missing: 'Hindi nakalista', partial: 'Bahagyang kabuuan; may kulang na halaga:',
    sources: 'Mga sanggunian', page: 'Pahina', collected: 'Nakolekta ang snapshot', snapshot: 'Bersyon ng snapshot',
    freshness: 'Maaaring mas bago ang live na tala sa portal. Hindi real-time ang snapshot.',
    stale: 'Lampas pitong araw na ang snapshot. Buksan ang sanggunian para tingnan ang pinakabagong tala.',
    records: 'tala', families: 'pamilya ng programa', matches: 'Tugmang tala',
  },
  en: {
    title: 'Ask about the budget', close: 'Close', language: 'Wika / Language',
    intro: 'National budget records naming Antipolo. This is not the complete City Hall budget.',
    privacy: 'When you use an AI explanation, your question and relevant context are sent to Google Gemini. They may be used to improve services and reviewed by people under Google’s terms. Do not include personal or sensitive information. The portal does not save conversations; reloading or starting a new conversation clears them.',
    terms: 'Google Gemini terms', suggestions: 'Suggested questions',
    questions: ['What is NEP?', 'Find roads in Mayamot in 2027', 'What is the difference between NEP and GAA?'],
    explain: 'Explain this project.', selected: 'Selected project', question: 'Your question',
    limit: 'Up to 500 characters. Enter adds a line; select Send to ask your question.',
    send: 'Send', waiting: 'Finding records and preparing the answer…', ready: 'The answer is ready.',
    newChat: 'New conversation', cleared: 'Started a new conversation.', simpler: 'Simpler explanation',
    simpleQuestion: 'Simpler explanation.', you: 'You',
    modes: { ai: 'AI explanation', reference: 'Reference answer', clarification: 'Clarification needed', no_data: 'No supporting records' },
    unavailable: 'AI explanations are currently unavailable. Records and sources are still available.',
    network: 'Your question could not be sent. Check your connection and try again.',
    service: 'Answers are temporarily unavailable. Try again later; you can still browse the portal.',
    throttled: 'There are too many questions right now. Wait a minute before trying again.',
    retry: 'Try again', facts: 'Figures from the records', missing: 'Not listed', partial: 'Partial total; missing amounts:',
    sources: 'Sources', page: 'Page', collected: 'Snapshot collected', snapshot: 'Snapshot version',
    freshness: 'The live portal may have newer records. This snapshot is not real-time.',
    stale: 'This snapshot is more than seven days old. Open the sources to check the latest records.',
    records: 'records', families: 'program families', matches: 'Matching records',
  },
};

const STAGES = {
  nep: 'NEP', house: 'House bill', hgab2: 'House bill · second reading', hgab3: 'House bill · third reading',
  api: 'DPWH transparency listing', gaa: 'GAA', 'house-minus-nep': 'House − NEP',
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
  const active = useRef<AbortController | null>(null);
  const [language, setLanguage] = useState<Language>('fil');
  const [project, setProject] = useState<string>();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'network' | 'service' | 'throttled' | null>(null);
  const [failedQuestion, setFailedQuestion] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const text = COPY[language];

  useEffect(() => () => active.current?.abort(), []);

  function cancel() {
    active.current?.abort();
    active.current = null;
    setPending(false);
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
      dialog.current?.showModal();
    },
  }), [language]);

  function newConversation() {
    cancel();
    setProject(undefined);
    setExchanges([]);
    setDraft('');
    setError(null);
    setFailedQuestion('');
    setAnnouncement(text.cleared);
    input.current?.focus();
  }

  async function send(question: string) {
    const message = question.trim();
    if (active.current || !message || message.length > 500) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    setAnnouncement('');
    setDraft(message);
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
      setProject(result.provenance.filter.projectKey ?? undefined);
      setDraft('');
      setAnnouncement(text.ready);
    } catch {
      if (active.current !== controller) return;
      setError(failure);
      setFailedQuestion(message);
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }

  return (
    <dialog ref={dialog} className="chat-panel" aria-labelledby="chat-title" lang={language} onClose={cancel}>
      <div className="chat-header">
        <h2 id="chat-title">{text.title}</h2>
        <button type="button" onClick={() => dialog.current?.close()}>{text.close}</button>
      </div>
      <p>{text.intro}</p>
      <div className="chat-actions">
        <label>{text.language}{' '}
          <select value={language} disabled={pending} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="fil">Filipino</option><option value="en">English</option>
          </select>
        </label>
        <button type="button" onClick={newConversation}>{text.newChat}</button>
      </div>
      <p className="chat-privacy">{text.privacy}{' '}
        <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">{text.terms} ↗</a>
      </p>
      {project && <p className="chat-context">{text.selected}: <strong>{project}</strong></p>}
      <section aria-label={text.suggestions} className="chat-suggestions">
        {text.questions.map((question) => (
          <button type="button" key={question} disabled={pending} onClick={() => { setDraft(question); input.current?.focus(); }}>{question}</button>
        ))}
      </section>
      <ol className="chat-conversation" aria-label={language === 'fil' ? 'Usapan' : 'Conversation'}>
        {exchanges.map((exchange, index) => (
          <li key={index} lang={exchange.language}>
            <p className="chat-question"><strong>{COPY[exchange.language].you}:</strong> {exchange.user}</p>
            <Answer response={exchange.response} language={exchange.language} turn={index} />
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" aria-atomic="true" className="chat-status">{pending ? text.waiting : announcement}</p>
      {error && <div className="chat-error" role="alert">
        <p>{text[error]}</p>
        <button type="button" disabled={pending} onClick={() => void send(failedQuestion)}>{text.retry}</button>
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <label htmlFor="chat-question">{text.question}</label>
        <textarea ref={input} id="chat-question" value={draft} maxLength={500} rows={3} required readOnly={pending}
          aria-describedby="chat-limit" onChange={(event) => setDraft(event.target.value)} />
        <p id="chat-limit">{text.limit} ({draft.length}/500)</p>
        <div className="chat-actions">
          <button className="chat-send" type="submit" aria-disabled={pending || !draft.trim()}>{text.send}</button>
          {exchanges.length > 0 && <button type="button" aria-disabled={pending} onClick={() => void send(project ? text.simpleQuestion
            : `${exchanges.at(-1)!.user.slice(0, 499 - text.simpleQuestion.length)} ${text.simpleQuestion}`)}>{text.simpler}</button>}
        </div>
      </form>
    </dialog>
  );
}

function Answer({ response: r, language, turn }: { response: ChatResponse; language: Language; turn: number }) {
  const text = COPY[language];
  return <article className="chat-answer" aria-label={text.modes[r.mode]}>
    <h3>{text.modes[r.mode]}</h3>
    {r.aiUnavailable && <p className="chat-notice">{text.unavailable}</p>}
    <p className="chat-prose">{r.answer}</p>
    {r.facts.length > 0 && <section aria-label={text.facts}>
      <h4>{text.facts}</h4>
      <dl className="chat-facts">
        {r.facts.map((fact) => <div key={fact.id}>
          <dt>{fact.label} · FY {fact.year} · {STAGES[fact.stage]}</dt>
          <dd>
            <strong>{fact.value === null ? text.missing : fact.unit === 'PHP' ? phpFull(fact.value) : `${fact.value.toLocaleString(language === 'fil' ? 'fil-PH' : 'en-PH')} ${text[fact.unit]}`}</strong>
            {fact.unit === 'PHP' && fact.value !== null && Math.abs(fact.value) >= 1000 && <span> ({php(fact.value)})</span>}
            {fact.missingCount > 0 && fact.value !== null && <p>{text.partial} {fact.missingCount}</p>}
            <span className="chat-fact-sources">{fact.sourceIds.map((id) => {
              const index = r.sources.findIndex((source) => source.id === id);
              return index < 0 ? null : <a key={id} href={`#chat-source-${turn}-${index}`}>{text.sources} {index + 1}</a>;
            })}</span>
          </dd>
        </div>)}
      </dl>
    </section>}
    <p>{text.matches}: {r.provenance.matchedCount}. {r.provenance.coverage}</p>
    {r.sources.length > 0 && <section aria-label={text.sources}>
      <h4>{text.sources}</h4>
      <ol className="chat-sources">
        {r.sources.map((source, index) => <li key={source.id} id={`chat-source-${turn}-${index}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}{source.page !== undefined ? ` · ${text.page} ${source.page}` : ''} ↗</a>
        </li>)}
      </ol>
    </section>}
    <div className="chat-snapshot">
      <p>{text.collected}: <time dateTime={r.snapshot.collectedAt}>{date(r.snapshot.collectedAt)}</time></p>
      <p>{text.snapshot}: {r.snapshot.id}</p>
      <p>{text.freshness}</p>
      {r.snapshot.stale && <p className="chat-notice">{text.stale}</p>}
      {r.snapshot.notice && <p>{r.snapshot.notice}</p>}
    </div>
  </article>;
}
