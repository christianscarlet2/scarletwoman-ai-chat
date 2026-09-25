import { useCallback, useEffect, useRef, useState } from 'react';

// Backend: Claude (through the confined claude-jail runner) + local Piper voice.
const API = (import.meta.env.VITE_API_URL || 'https://swiftsnake.scarletbeast.com:8002').replace(/\/$/, '');
const MAX = 1000;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

const summonLine = () => {
  const d = new Date();
  return `Behold, I summon the Scarlet Woman on ${d.toLocaleDateString('en-US')} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
};

// ---------- free fallback voice (browser speechSynthesis) ----------
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices?.() || [];
  const pref = ['Microsoft Sonia', 'Microsoft Libby', 'Microsoft Hazel', 'Google UK English Female', 'Serena', 'Kate', 'Microsoft Zira', 'Samantha'];
  for (const n of pref) { const v = vs.find((x) => x.name.includes(n)); if (v) return v; }
  return vs.find((v) => /female|woman/i.test(v.name)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

function Sigil({ speaking }) {
  return (
    <div className={`sigil ${speaking ? 'is-speaking' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 200 200" className="sigil-ring">
        <defs><path id="ring" d="M100,100 m-84,0 a84,84 0 1,1 168,0 a84,84 0 1,1 -168,0" /></defs>
        <text><textPath href="#ring">I AM SHE WHO SITS UPON MANY WATERS ✶ MYSTERY ✶ BABYLON THE GREAT ✶ </textPath></text>
      </svg>
      <img src="/images/scarlet-woman-face.webp" alt="" width="128" height="128" />
    </div>
  );
}

export default function App() {
  const [convo, setConvo] = useState(() => store.get('sw.convo', newId()));
  const [msgs, setMsgs] = useState(() => store.get('sw.msgs', []));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => store.get('sw.voice', true));
  const [playing, setPlaying] = useState(null); // message id currently sounding
  const [listening, setListening] = useState(false);
  const audioRef = useRef(null);
  const recRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const canListen = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => { store.set('sw.convo', convo); }, [convo]);
  useEffect(() => { store.set('sw.msgs', msgs.slice(-40)); }, [msgs]);
  useEffect(() => { store.set('sw.voice', voiceOn); }, [voiceOn]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    if (!window.speechSynthesis) return undefined;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener?.('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', warm);
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
    setPlaying(null);
  }, []);

  const speakFallback = useCallback((m) => {
    const s = window.speechSynthesis;
    if (!s || typeof SpeechSynthesisUtterance === 'undefined') return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(m.text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 0.92; u.pitch = 1.0;
    u.onend = () => setPlaying(null);
    u.onerror = () => setPlaying(null);
    setPlaying(m.id);
    s.speak(u);
  }, []);

  const play = useCallback((m) => {
    stopAudio();
    const a = audioRef.current;
    if (!a || !m.voice) return speakFallback(m);
    a.src = API + m.voice;
    a.onended = () => setPlaying(null);
    a.onerror = () => speakFallback(m); // server voice failed: free browser voice instead
    setPlaying(m.id);
    a.play().catch(() => setPlaying(null)); // autoplay refused: the play button still works
  }, [stopAudio, speakFallback]);

  const send = useCallback(async (raw) => {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    if (message.length > MAX) { setErr(`Keep it under ${MAX} characters.`); return; }
    setErr(''); setBusy(true); setText(''); stopAudio();
    setMsgs((p) => [...p, { id: newId(), who: 'you', text: message }]);
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation: convo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.reply) throw new Error(d.error || 'Her voice falters. Ask again in a moment.');
      const m = { id: d.id, who: 'her', text: d.reply, kind: d.kind, voice: d.voice };
      setMsgs((p) => [...p, m]);
      if (voiceOn) play(m);
    } catch (e) {
      setErr(e.message === 'Failed to fetch' ? 'She cannot be reached right now. Try again soon.' : e.message);
    } finally {
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [text, busy, convo, voiceOn, play, stopAudio]);

  const listen = () => {
    if (listening) { recRef.current?.stop(); return; }
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return;
    const rec = new R();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.onresult = (e) => setText(Array.from(e.results).map((x) => x[0].transcript).join(' ').slice(0, MAX));
    rec.onerror = (e) => { setListening(false); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('The microphone is blocked here. Type instead.'); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const reset = () => { stopAudio(); setMsgs([]); setConvo(newId()); setErr(''); };
  const started = msgs.length > 0;

  return (
    <div className="sw">
      <audio ref={audioRef} preload="none" />
      <header className="sw-top">
        <div className="sw-brand">
          <span className="sw-eyebrow">Scarlet Beast · Oracle</span>
          <h1>The Scarlet Woman</h1>
        </div>
        <div className="sw-ai" role="note" aria-label="Disclosure: this is an AI">
          <b>AI</b><span>You are talking to an AI character, not a person.</span>
        </div>
        <div className="sw-controls">
          <button type="button" className={`ctl ${voiceOn ? 'on' : ''}`} aria-pressed={voiceOn}
            onClick={() => { if (voiceOn) stopAudio(); setVoiceOn(!voiceOn); }}
            title="Her AI-generated voice on or off">
            <span className="ctl-dot" />Voice {voiceOn ? 'on' : 'off'}
          </button>
          <button type="button" className="ctl stop" onClick={stopAudio} disabled={!playing} title="Stop audio">
            <span className="ctl-sq" />Stop
          </button>
          {started && <button type="button" className="ctl ghost" onClick={reset} title="Start over">New</button>}
        </div>
      </header>

      <main className="sw-stage" aria-live="polite">
        {!started && (
          <section className="sw-altar">
            <Sigil speaking={busy} />
            <p className="sw-kicker">Mystery, Babylon the Great</p>
            <p className="sw-intro">She sits upon many waters and answers in riddles. Ask her anything. She is an AI character, so treat her words as poetry, not prophecy.</p>
            <button type="button" className="sw-summon" onClick={() => send(summonLine())} disabled={busy}>
              {busy ? 'She stirs…' : 'Summon her'}
            </button>
          </section>
        )}

        {started && (
          <ol className="sw-log">
            {msgs.map((m) => (
              <li key={m.id} className={`msg ${m.who} ${m.kind || ''}`}>
                {m.who === 'her' ? (
                  <>
                    <div className="msg-head">
                      <img src="/images/scarlet-woman-face.webp" alt="" className="msg-av" width="28" height="28" />
                      <span className="msg-name">Scarlet Woman</span>
                      <span className="tag">AI</span>
                      {m.kind === 'crisis' && <span className="tag help">Help</span>}
                    </div>
                    <p className="msg-text">{m.text}</p>
                    <div className="msg-voice">
                      {playing === m.id ? (
                        <button type="button" className="play is-on" onClick={stopAudio}><span className="bars"><i /><i /><i /></span>Stop</button>
                      ) : (
                        <button type="button" className="play" onClick={() => play(m)}>▶ Hear her</button>
                      )}
                      <span className="voice-label">AI-generated voice</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="msg-name you">You</span>
                    <p className="msg-text">{m.text}</p>
                  </>
                )}
              </li>
            ))}
            {busy && (
              <li className="msg her pending"><div className="msg-head"><span className="msg-name">Scarlet Woman</span><span className="tag">AI</span></div><p className="msg-text"><span className="ripple" />the waters stir…</p></li>
            )}
            <li ref={endRef} className="end" aria-hidden="true" />
          </ol>
        )}
      </main>

      <footer className="sw-foot">
        {err && <p className="sw-err" role="alert">{err}</p>}
        <form className="sw-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label htmlFor="sw-in" className="sr">Your message to the Scarlet Woman</label>
          <textarea id="sw-in" ref={inputRef} rows={1} value={text} maxLength={MAX} disabled={busy}
            placeholder={started ? 'Speak to her…' : 'Ask her anything…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          {canListen && (
            <button type="button" className={`mic ${listening ? 'is-on' : ''}`} onClick={listen} disabled={busy}
              aria-pressed={listening} title="Speak instead of typing (your browser's speech recognition)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" /></svg>
              <span className="sr">{listening ? 'Stop listening' : 'Speak'}</span>
            </button>
          )}
          <button type="submit" className="send" disabled={busy || !text.trim()}>Send</button>
        </form>
        <p className="sw-fine">
          AI-generated text (Claude) and voice (Piper). Not advice, not prophecy.
          In crisis? Call or text <a href="tel:988">988</a> or visit <a href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com</a>.
          {' '}<a href="https://scarletbeast.com/ai-policy/" target="_blank" rel="noreferrer">Our AI policy</a>.
        </p>
      </footer>
    </div>
  );
}
