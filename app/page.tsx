'use client';

import { useState, useRef, useEffect } from 'react';
import Masthead from './Masthead';

interface Turn {
  role: 'client' | 'bot';
  text: string;
  imageUrl?: string;
}

const STUDIO_ID = 'studio_demo';
const DEMO_PHONE = '+91-98765-43210';
const INITIAL_GREETING = '👋 Say something like "Hi, I want a tattoo" or attach a reference photo to start.';

export default function SimulatorPage() {
  const [turns, setTurns] = useState<Turn[]>([
    { role: 'bot', text: INITIAL_GREETING }
  ]);
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [stage, setStage] = useState('greeting');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [turns, loading]);

  function handleFileSelect(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WebP, etc.).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setSelectedImage(dataUrl);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          handleFileSelect(file);
          break;
        }
      }
    }
  }

  async function resetConversation() {
    setTurns([{ role: 'bot', text: INITIAL_GREETING }]);
    setInput('');
    setSelectedImage(null);
    setImageName('');
    setStage('greeting');
    setLoading(false);
    inputRef.current?.focus();

    try {
      await fetch('/api/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studioId: STUDIO_ID, clientPhone: DEMO_PHONE, reset: true })
      });
    } catch {
      // ignore network errors on reset
    }
  }

  async function send() {
    const message = input.trim();
    const currentImage = selectedImage;
    if ((!message && !currentImage) || loading) return;

    // Display client bubble with image if attached
    setTurns((t) => [
      ...t,
      {
        role: 'client',
        text: message,
        imageUrl: currentImage || undefined
      }
    ]);

    setInput('');
    setSelectedImage(null);
    setImageName('');
    setLoading(true);

    // Keep focus active so users can continue typing on mobile & desktop
    inputRef.current?.focus();

    try {
      const res = await fetch('/api/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studioId: STUDIO_ID,
          clientPhone: DEMO_PHONE,
          message: message || (currentImage ? 'Here is a reference photo for my tattoo.' : ''),
          imageUrl: currentImage || undefined
        })
      });
      const data = await res.json();
      if (data.error) {
        setTurns((t) => [...t, { role: 'bot', text: `⚠️ ${data.error}` }]);
      } else {
        setTurns((t) => [...t, { role: 'bot', text: data.reply }]);
        setStage(data.stage);
      }
    } catch (e: any) {
      setTurns((t) => [...t, { role: 'bot', text: `⚠️ Error: ${e.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }

  return (
    <div className="page" onPaste={handlePaste}>
      <Masthead activeTab="chat" />

      <h1>Booking Bot Simulator</h1>
      <p className="subtitle">
        Simulates the client experience on WhatsApp with reference photo uploads. The same logic runs behind a real WhatsApp Business account.
      </p>

      <div className="section-toolbar">
        <div className="toolbar-status">
          <span className="stage-tag">
            <span className="stage-dot" />
            STAGE: {stage}
          </span>
        </div>
        <button
          type="button"
          className="btn-reset"
          onClick={resetConversation}
          title="Reset conversation flow for demo"
        >
          ↺ Reset Conversation
        </button>
      </div>

      <div className="chat-window" ref={scrollRef}>
        {turns.map((t, i) => {
          // Visually distinguish initial instruction from conversational bot voice
          if (i === 0 && t.role === 'bot') {
            return (
              <div key={i} className="instruction-card">
                <div className="instruction-header">
                  <span className="instruction-badge">Demo Instruction</span>
                  <span className="instruction-tag">Getting Started</span>
                </div>
                <div className="instruction-body">{t.text}</div>
              </div>
            );
          }

          return (
            <div key={i} className={`bubble ${t.role}`}>
              {t.imageUrl && (
                <div className="bubble-image-container">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.imageUrl}
                    alt="Tattoo reference attachment"
                    className="bubble-image"
                  />
                </div>
              )}
              {t.text && <div>{t.text}</div>}
            </div>
          );
        })}

        {loading && (
          <div className="typing-bubble" aria-label="Bot is typing">
            <span className="ink-dot" />
            <span className="ink-dot" />
            <span className="ink-dot" />
          </div>
        )}
      </div>

      {/* Selected Image Preview Strip */}
      {selectedImage && (
        <div className="attached-preview-strip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage}
            alt="Attachment preview"
            className="attached-mini-thumb"
          />
          <div className="attached-info">
            <span className="attached-label">Reference Photo Attached</span>
            <span className="attached-name">{imageName || 'reference-photo.jpg'}</span>
          </div>
          <button
            type="button"
            className="btn-remove-attachment"
            onClick={() => {
              setSelectedImage(null);
              setImageName('');
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            title="Remove attached photo"
          >
            ✕
          </button>
        </div>
      )}

      <div className="input-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
        />

        <button
          type="button"
          className="btn-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Attach reference tattoo image from device (or paste via clipboard)"
        >
          📷 Photo
        </button>

        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            selectedImage
              ? "Add an optional description (e.g., 'fine line on my arm') and press Enter…"
              : "Type a client message or attach a reference image (e.g. 'Hi, I want this tattoo')…"
          }
          autoComplete="off"
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || (!input.trim() && !selectedImage)}
        >
          Send
        </button>
      </div>

      <p className="hint">
        <strong>Try Photo Upload:</strong> Click <strong>📷 Photo</strong> (or paste with <code>Cmd+V</code>) to attach a tattoo design photo. The image is saved to the database under this client&apos;s lead number, automatically analyzed for style/complexity, and visible in real time on the <strong>Dashboard</strong> tab.
      </p>
    </div>
  );
}
