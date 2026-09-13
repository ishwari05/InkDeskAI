'use client';

import { useEffect, useState } from 'react';
import Masthead from '../Masthead';

interface Lead {
  id: string;
  client_phone: string;
  placement: string | null;
  size_label: string | null;
  style: string | null;
  reference_note: string | null;
  reference_image_url: string | null;
  quoted_price_low: number | null;
  quoted_price_high: number | null;
  status: string;
  created_at: string;
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (isNaN(diffSec)) return '—';
    if (diffSec < 45) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/leads');
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch (e) {
      console.error('Failed to load leads', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Close lightbox on Escape key
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewLead(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="page">
      <Masthead activeTab="dashboard" />

      <h1>Studio Leads Dashboard</h1>
      <p className="subtitle">
        Every incoming consultation handled by Studio Bot, and where each client left off in the pipeline.
      </p>

      <div className="section-toolbar">
        <div className="toolbar-status">
          <span className="stage-tag">
            <span className="stage-dot" />
            {loading ? 'CHECKING DATABASE…' : `${leads.length} ${leads.length === 1 ? 'LEAD CAPTURED' : 'LEADS CAPTURED'}`}
          </span>
        </div>
        <button
          type="button"
          className="btn-refresh"
          onClick={load}
          disabled={loading}
          title="Pull latest leads from database"
        >
          {loading ? '↻ Refreshing…' : '↻ Refresh Leads'}
        </button>
      </div>

      {loading ? (
        <div className="table-wrapper">
          <div className="loading-indicator-row">
            <span className="ink-dot" />
            <span className="ink-dot" />
            <span className="ink-dot" />
            <span>Fetching studio leads…</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Reference</th>
                <th>Placement</th>
                <th>Size</th>
                <th>Style</th>
                <th>Quote (₹)</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((n) => (
                <tr key={n} className="skeleton-row">
                  <td><div className="skeleton-box medium" /></td>
                  <td><div className="skeleton-box short" /></td>
                  <td><div className="skeleton-box short" /></td>
                  <td><div className="skeleton-box short" /></td>
                  <td><div className="skeleton-box medium" /></td>
                  <td><div className="skeleton-box short" /></td>
                  <td><div className="skeleton-box short" /></td>
                  <td><div className="skeleton-box short" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : leads.length === 0 ? (
        <div className="table-wrapper" style={{ padding: '36px 20px', textAlign: 'center' }}>
          <p className="subtitle" style={{ margin: 0 }}>
            No leads recorded yet. Open the <strong>Simulate Chat</strong> tab to start a demo conversation.
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Reference</th>
                <th>Placement</th>
                <th>Size</th>
                <th>Style</th>
                <th>Quote (₹)</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.client_phone}</strong>
                  </td>
                  <td>
                    {l.reference_image_url ? (
                      <button
                        type="button"
                        className="img-thumb-btn"
                        onClick={() => setPreviewLead(l)}
                        title="Click to view reference image"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={l.reference_image_url}
                          alt={`Reference for ${l.client_phone}`}
                          className="table-img-thumb"
                        />
                      </button>
                    ) : (
                      <span className="no-image-tag">—</span>
                    )}
                  </td>
                  <td>{l.placement ?? '—'}</td>
                  <td>{l.size_label ?? '—'}</td>
                  <td>{l.style ?? '—'}</td>
                  <td>
                    {l.quoted_price_low && l.quoted_price_high
                      ? `${l.quoted_price_low.toLocaleString('en-IN')}–${l.quoted_price_high.toLocaleString('en-IN')}`
                      : '—'}
                  </td>
                  <td>
                    <span className={`status-pill status-${l.status}`}>
                      {l.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="time-cell" title={l.created_at}>
                    {formatRelativeTime(l.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lightbox Modal for Full Reference Photo */}
      {previewLead && previewLead.reference_image_url && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewLead(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="image-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <div>
                <h3 className="image-modal-title">Client Tattoo Reference</h3>
                <span className="image-modal-subtitle">
                  {previewLead.client_phone} • {previewLead.placement || 'Placement not set'} • {previewLead.style || 'Style pending'}
                </span>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setPreviewLead(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="image-modal-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewLead.reference_image_url}
                alt={`Tattoo reference for ${previewLead.client_phone}`}
                className="image-modal-img"
              />
            </div>

            {previewLead.reference_note && (
              <div className="image-modal-note">
                <strong>Notes / Vision Analysis:</strong> {previewLead.reference_note}
              </div>
            )}

            <div className="image-modal-footer">
              <a
                href={previewLead.reference_image_url}
                target="_blank"
                rel="noreferrer"
                className="btn-open-original"
                download={`tattoo-ref-${previewLead.client_phone}.jpg`}
              >
                Open Full Resolution ↗
              </a>
              <button
                type="button"
                className="btn-modal-done"
                onClick={() => setPreviewLead(null)}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="hint">
        <strong>Live Demo Note:</strong> As you chat in the simulator, click <strong>↻ Refresh Leads</strong> to immediately see new quotes and status transitions (such as <code>quoted</code> or <code>booking requested</code>) recorded in real time.
      </p>
    </div>
  );
}
