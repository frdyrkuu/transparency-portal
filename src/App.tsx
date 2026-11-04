import { useRef } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import ChatPanel, { type ChatPanelHandle } from './components/ChatPanel';
import { Footer, Masthead } from './components/Chrome';
import ScrollToTop from './components/ScrollToTop';
import { configProblems } from './config';
import { usePortal } from './lib/portal-context';
import About from './pages/About';
import Home from './pages/Home';
import Project from './pages/Project';
import Enacted from './pages/Enacted';

export default function App() {
  const { config } = usePortal();
  const chat = useRef<ChatPanelHandle>(null);
  const problems = import.meta.env.DEV ? configProblems(config) : [];
  return (
    <>
      <ScrollToTop />
      <Masthead />
      {problems.length > 0 && (
        <div className="page config-warning" role="alert">
          <strong>portal.config.ts needs attention</strong> (shown in development only):
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Offices and their districts are a section of the main page; old links land there. */}
        <Route path="/districts" element={<Navigate to="/#offices" replace />} />
        <Route path="/gaa" element={<Enacted />} />
        <Route path="/about" element={<About />} />
        <Route path="/projects/:dataset/:id" element={<Project onExplain={(key) => chat.current?.open(key)} />} />
        <Route
          path="*"
          element={
            <main className="page main">
              <p className="state">This page does not exist. <Link to="/">See every project</Link></p>
            </main>
          }
        />
      </Routes>
      <Footer />
      <button type="button" className="button button-primary chat-open chat-launcher" aria-haspopup="dialog" aria-controls="budget-chat" onClick={() => chat.current?.open()}>
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h0a8.5 8.5 0 0 1 8.5 8.5Z" />
          <path d="M7 9h9M7 13h6" />
        </svg>
        <span>Magtanong tungkol sa budget</span>
      </button>
      <ChatPanel ref={chat} />
    </>
  );
}
