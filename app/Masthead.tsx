'use client';

import Link from 'next/link';

interface MastheadProps {
  activeTab: 'chat' | 'dashboard';
}

export default function Masthead({ activeTab }: MastheadProps) {
  return (
    <header className="masthead">
      <div className="masthead-top">
        <div className="masthead-brand">
          <span className="masthead-tag">FLASH SHEET // AI ASSISTANT</span>
          <div className="masthead-title">INK &amp; IRON TATTOO CO.</div>
        </div>
        <div className="masthead-meta">
          <span className="masthead-badge">LIVE AGENT DEMO</span>
        </div>
      </div>
      <nav className="masthead-nav">
        <Link
          href="/"
          className={`masthead-tab ${activeTab === 'chat' ? 'active' : ''}`}
        >
          Simulate Chat
        </Link>
        <Link
          href="/dashboard"
          className={`masthead-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          Dashboard
        </Link>
      </nav>
    </header>
  );
}
