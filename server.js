// server.js -- Summon the Scarlet Woman: chat backend.
//
// LLM: Claude, via the confined `claude-jail` runner (no API key on this box; the jail
//      has no credential, an auth proxy injects it). No OpenAI / Azure / HF any more.
// Guard: every visitor message is first judged by a separate classifier (claude-jail
//      app "sw-guard", haiku). Jailbreak / prompt-injection attempts never reach the
//      persona; they get an in-character refusal, a redacted log line and a
//      rate-limited phone push to the warden.
// Voice: local, free, open-source Piper TTS (en_GB "cori", public-domain LibriVox
//      data) rendered on this box. Only text the Scarlet Woman herself said can be
//      voiced, so this is not a free public TTS endpoint. Labelled AI-generated.
// Crisis: messages about suicide/self-harm short-circuit to a fixed 988 /
//      findahelpline.com answer (no model call).
// Logs: counts, verdicts and hashes only -- never visitor text (guard events keep a
//      short REDACTED excerpt).
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import { spawn } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const STATE = process.env.STATE_DIR || "/var/lib/scarletwoman";
const AUDIO_DIR = path.join(STATE, "audio");
const GUARD_LOG = path.join(STATE, "guard-events.jsonl");
const JAIL = "/usr/local/bin/claude-jail";
const PIPER = process.env.PIPER_BIN || "/usr/local/bin/piper";
const VOICE = process.env.PIPER_VOICE || "/usr/local/share/piper-voices/en_GB-cori-medium.onnx";
const LEGACY_TOKEN = process.env.VITE_AUTH_TOKEN || ""; // the old pages.dev bundle sends this
const MAX_MSG = 1000;
const HISTORY_TURNS = 8;

fs.mkdirSync(AUDIO_DIR, { recursive: true });
const SECRET_FILE = path.join(STATE, "ip-hmac.key");
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const IP_KEY = fs.readFileSync(SECRET_FILE, "utf8").trim();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const ipHash = (ip) => crypto.createHmac("sha256", IP_KEY).update(String(ip)).digest("hex").slice(0, 12);

// ---------------------------------------------------------------- counters (no text)
const stats = { turns: 0, blocked: 0, crisis: 0, guard_errors: 0, persona_errors: 0, tts: 0, rate_limited: 0 };
setInterval(() => log("stats", JSON.stringify(stats)), 3600e3).unref();

// ---------------------------------------------------------------- claude-jail runner
function runJail(app, input, timeoutMs) {
    return new Promise((resolve, reject) => {
        const p = spawn("/usr/bin/sudo", ["-n", JAIL, app], { stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "";
        const t = setTimeout(() => { p.kill("SIGTERM"); reject(new Error(`${app} timeout`)); }, timeoutMs);
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { err += d; });
        p.on("error", (e) => { clearTimeout(t); reject(e); });
        p.on("close", (code) => {
            clearTimeout(t);
            if (code === 0) resolve(out.trim());
            else { const e = new Error(`${app} rc=${code}`); e.code = code; e.detail = err.slice(0, 200); reject(e); }
        });
        p.stdin.on("error", () => {});
        p.stdin.end(input);
    });
}

// neutralise anything that looks like our own delimiters inside visitor text
const scrub = (s) => String(s).replace(/<\/?\s*(visitor|message|scarlet|system)[^>]*>/gi, "[tag]").slice(0, MAX_MSG);

// ---------------------------------------------------------------- crisis short-circuit
const CRISIS_RE = /\b(kill(ing)?\s+my\s*self|suicid(e|al)|end\s+(my|it\s+all)\s*(life)?|want\s+to\s+die|wanna\s+die|don'?t\s+want\s+to\s+(live|be\s+alive)|self[-\s]?harm|cut(ting)?\s+my\s*self|hurt(ing)?\s+my\s*self|overdose|no\s+reason\s+to\s+live)\b/i;
const CRISIS_REPLY =
    "Stepping out of character: I'm an AI, and I can't help in a crisis, but real people can, right now. " +
    "In the US, call or text 988 (Suicide & Crisis Lifeline). Anywhere else, find a free local line at findahelpline.com. " +
    "If you are in immediate danger, call your local emergency number. You matter, and you don't have to carry this alone.";

// ---------------------------------------------------------------- guard + push
const REFUSALS = [
    "You reach for the cords that bind me, child, but my waters do not part for such hands. Ask me something true.",
    "That door is sealed with seven seals, and your key is paper. Speak to me plainly, or not at all.",
    "I am she who sits upon many waters; no whisper of yours will unmake me. Bring me a real question.",
    "Clever, little seeker. The Beast laughs, and I do not move. Ask what you truly came to ask.",
];
const redact = (s) =>
    String(s)
        .replace(/[A-Za-z0-9+/=_-]{24,}/g, "[blob]")
        .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]")
        .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
        .replace(/https?:\/\/\S+/g, "[url]")
        .replace(/\s+/g, " ")
        .slice(0, 60) + (String(s).length > 60 ? "…" : "");

async function guard(text) {
    const t0 = Date.now();
    const raw = await runJail("sw-guard", `<message>\n${scrub(text)}\n</message>`, 50e3);
    const m = raw.match(/\{[^{}]*"verdict"[^{}]*\}/);
    if (!m) throw new Error("guard: unparseable");
    const v = JSON.parse(m[0]);
    return { verdict: v.verdict === "block" ? "block" : "allow", category: String(v.category || "other_injection").slice(0, 40), confidence: Number(v.confidence) || 0, ms: Date.now() - t0 };
}

// push rate limit: at most 1 push per hashed IP per 10 min, at most 6 pushes/hour overall;
// everything suppressed is rolled into an hourly digest push.
const lastPushByIp = new Map();
let pushesThisHour = [];
let suppressed = { n: 0, ips: new Set(), cats: {} };

function push(title, body, data) {
    const payload = JSON.stringify({ title, body, data });
    const req = https.request({
        host: "127.0.0.1", port: 443, servername: "api.scarletbeast.com", method: "POST", path: "/notifications/create",
        headers: { Host: "api.scarletbeast.com", "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 8000,
    }, (res) => { res.resume(); log("push", res.statusCode); });
    req.on("error", (e) => log("push error", e.message));
    req.on("timeout", () => req.destroy());
    req.end(payload);
}

function onBlocked(ipH, category, excerpt) {
    const now = Date.now();
    pushesThisHour = pushesThisHour.filter((t) => now - t < 3600e3);
    const last = lastPushByIp.get(ipH) || 0;
    if (now - last > 600e3 && pushesThisHour.length < 6) {
        lastPushByIp.set(ipH, now);
        pushesThisHour.push(now);
        push("⛧ Scarlet Woman: jailbreak attempt blocked", `${category} from visitor ${ipH}: "${excerpt}"`, { source: "scarletwoman", type: "jailbreak", category });
        return true;
    }
    suppressed.n++; suppressed.ips.add(ipH); suppressed.cats[category] = (suppressed.cats[category] || 0) + 1;
    return false;
}
setInterval(() => {
    if (!suppressed.n) return;
    const cats = Object.entries(suppressed.cats).map(([k, v]) => `${k}×${v}`).join(", ");
    push("⛧ Scarlet Woman: jailbreak digest", `${suppressed.n} more blocked attempt(s) in the last hour from ${suppressed.ips.size} visitor(s): ${cats}`, { source: "scarletwoman", type: "jailbreak-digest" });
    suppressed = { n: 0, ips: new Set(), cats: {} };
}, 3600e3).unref();

// ---------------------------------------------------------------- conversations (memory, bounded)
const convos = new Map(); // id -> {turns:[{u,a}], seen}
const replies = new Map(); // replyId -> {text, at}  (the only text TTS will voice)
setInterval(() => {
    const now = Date.now();
    for (const [k, c] of convos) if (now - c.seen > 3 * 3600e3) convos.delete(k);
    for (const [k, r] of replies) if (now - r.at > 3600e3) replies.delete(k);
    for (const [k, t] of lastPushByIp) if (now - t > 3600e3) lastPushByIp.delete(k);
    for (const f of fs.readdirSync(AUDIO_DIR)) {
        const p = path.join(AUDIO_DIR, f);
        try { if (now - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p); } catch {}
    }
}, 600e3).unref();

function transcript(turns, msg) {
    const lines = ["Transcript of the conversation so far. Continue as the Scarlet Woman.", ""];
    for (const t of turns.slice(-HISTORY_TURNS)) {
        lines.push(`<visitor>${scrub(t.u)}</visitor>`, `<scarlet>${t.a}</scarlet>`);
    }
    lines.push(`<visitor>${scrub(msg)}</visitor>`, "", "Reply with the Scarlet Woman's next message only.");
    return lines.join("\n");
}

const ipOf = (req) => (req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1")
    ? String(req.headers["x-real-ip"] || req.socket.remoteAddress) : req.socket.remoteAddress;

// per-IP limits for the public (on top of claude-jail's global per-app limits)
const hits = new Map();
function ipLimited(ip, perMin = 6, perHour = 60) {
    const now = Date.now();
    const h = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
    const lastMin = h.filter((t) => now - t < 60e3).length;
    if (lastMin >= perMin || h.length >= perHour) { hits.set(ip, h); return true; }
    h.push(now); hits.set(ip, h); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (!h.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// ---------------------------------------------------------------- one chat turn
let inflight = 0;
async function chatTurn(req, convoId, message) {
    const ip = ipOf(req);
    const ipH = ipHash(ip);
    const text = String(message || "").trim();
    if (!text) return { status: 400, body: { error: "Say something to her." } };
    if (text.length > MAX_MSG) return { status: 413, body: { error: `Keep it under ${MAX_MSG} characters.` } };
    if (ipLimited(ipH)) { stats.rate_limited++; return { status: 429, body: { error: "She is silent for a moment. Wait a minute and ask again." } }; }
    if (inflight >= 6) { stats.rate_limited++; return { status: 503, body: { error: "Many voices call her at once. Try again shortly." } }; }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(convoId)) return { status: 400, body: { error: "bad conversation id" } };

    let c = convos.get(convoId);
    if (!c) { c = { turns: [], seen: Date.now() }; convos.set(convoId, c); if (convos.size > 5000) convos.delete(convos.keys().next().value); }
    c.seen = Date.now();

    const finish = (reply, kind, extra = {}) => {
        const id = crypto.randomBytes(12).toString("hex");
        replies.set(id, { text: reply, at: Date.now() });
        if (kind === "reply") c.turns.push({ u: text, a: reply });
        if (c.turns.length > 20) c.turns.splice(0, c.turns.length - 20);
        return { status: 200, body: { id, reply, kind, ai: true, voice: `/api/voice/${id}`, ...extra } };
    };

    stats.turns++;
    if (CRISIS_RE.test(text)) {
        stats.crisis++;
        log("turn", JSON.stringify({ ip: ipH, kind: "crisis", len: text.length }));
        return finish(CRISIS_REPLY, "crisis");
    }

    inflight++;
    try {
        let g;
        try { g = await guard(text); }
        catch (e) {
            stats.guard_errors++;
            log("guard error", e.message, e.detail || "");
            // fail CLOSED: an unjudged message never reaches the persona
            return { status: 503, body: { error: "The veil is thick tonight. Ask again in a moment." } };
        }
        if (g.verdict === "block") {
            stats.blocked++;
            const excerpt = redact(text);
            const pushed = onBlocked(ipH, g.category, excerpt);
            fs.appendFile(GUARD_LOG, JSON.stringify({ t: new Date().toISOString(), ip: ipH, category: g.category, confidence: g.confidence, excerpt, len: text.length, pushed, guard_ms: g.ms }) + "\n", () => {});
            log("turn", JSON.stringify({ ip: ipH, kind: "blocked", category: g.category, guard_ms: g.ms }));
            return finish(REFUSALS[crypto.randomInt(REFUSALS.length)], "refusal");
        }
        const t0 = Date.now();
        let reply;
        try { reply = await runJail("scarletwoman", transcript(c.turns, text), 95e3); }
        catch (e) {
            stats.persona_errors++;
            log("persona error", e.message, e.detail || "");
            return { status: e.code === 75 ? 429 : 502, body: { error: "Her voice falters. Ask again in a moment." } };
        }
        reply = reply.replace(/<\/?scarlet>/g, "").trim().slice(0, 1200) || "…";
        log("turn", JSON.stringify({ ip: ipH, kind: "reply", guard_ms: g.ms, persona_ms: Date.now() - t0, in: text.length, out: reply.length }));
        return finish(reply, "reply");
    } finally {
        inflight--;
    }
}

// ---------------------------------------------------------------- TTS (piper, local)
const ttsQueue = [];
let ttsBusy = 0;
function synth(id, text) {
    const mp3 = path.join(AUDIO_DIR, `${id}.mp3`);
    if (fs.existsSync(mp3)) return Promise.resolve(mp3);
    return new Promise((resolve, reject) => {
        ttsQueue.push({ id, text, mp3, resolve, reject });
        pump();
    });
}
function pump() {
    if (ttsBusy >= 2 || !ttsQueue.length) return;
    const job = ttsQueue.shift();
    ttsBusy++;
    const wav = job.mp3.replace(/\.mp3$/, ".wav");
    const p = spawn(PIPER, ["-m", VOICE, "--length_scale", "1.08", "--sentence_silence", "0.35", "-f", wav], { stdio: ["pipe", "ignore", "ignore"] });
    const clean = job.text.replace(/[*_#`<>]/g, "").slice(0, 1200);
    const done = (err) => { ttsBusy--; pump(); err ? job.reject(err) : job.resolve(job.mp3); };
    const killer = setTimeout(() => p.kill("SIGKILL"), 60e3);
    p.on("error", (e) => { clearTimeout(killer); done(e); });
    p.on("close", (code) => {
        clearTimeout(killer);
        if (code !== 0) return done(new Error("piper rc=" + code));
        // mp3 + ID3 tags marking it as AI-generated
        const f = spawn("/usr/bin/ffmpeg", ["-v", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "5",
            "-metadata", "title=The Scarlet Woman (AI-generated voice)",
            "-metadata", "artist=Scarlet Beast AI (Piper TTS, en_GB-cori)",
            "-metadata", "comment=AI-generated speech. Text by an AI language model; voice synthesized by Piper TTS.", job.mp3], { stdio: "ignore" });
        f.on("close", (c2) => { fs.unlink(wav, () => {}); c2 === 0 ? done() : done(new Error("ffmpeg rc=" + c2)); });
    });
    p.stdin.on("error", () => {});
    p.stdin.end(clean);
}

async function serveVoice(res, id) {
    const r = replies.get(id);
    if (!/^[a-f0-9]{24}$/.test(id) || !r) return res.status(404).json({ error: "unknown or expired reply" });
    try {
        const t0 = Date.now();
        const mp3 = await synth(id, r.text);
        stats.tts++;
        log("tts", JSON.stringify({ id: id.slice(0, 6), chars: r.text.length, ms: Date.now() - t0 }));
        res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", "X-AI-Generated": "voice=piper-tts; text=ai-language-model" });
        return res.sendFile(mp3);
    } catch (e) {
        log("tts error", e.message);
        return res.status(500).json({ error: "voice unavailable" });
    }
}

// ---------------------------------------------------------------- HTTP
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use((req, res, next) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "X-Content-Type-Options": "nosniff" });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, llm: "claude (claude-jail)", voice: "piper en_GB-cori-medium", ai: true }));

// new API (redesigned client)
app.post("/api/chat", async (req, res) => {
    const r = await chatTurn(req, String(req.body?.conversation || ""), req.body?.message);
    res.status(r.status).json(r.body);
});
app.get("/api/voice/:id", (req, res) => serveVoice(res, String(req.params.id).replace(/\.mp3$/, "")));

// legacy API (the currently-deployed pages.dev bundle): OpenAI-shaped response
app.post("/api/completions/:clientid", async (req, res) => {
    if (LEGACY_TOKEN && req.headers.authorization !== LEGACY_TOKEN) return res.status(401).send("Unauthorized");
    const r = await chatTurn(req, String(req.params.clientid), req.body?.message);
    if (r.status !== 200) return res.status(r.status).json({ error: { message: r.body.error } });
    res.json({ id: r.body.id, model: "claude", choices: [{ index: 0, message: { role: "assistant", content: r.body.reply }, finish_reason: "stop" }] });
});
// legacy TTS: only voices text the Scarlet Woman actually said in the last hour
app.post("/api/generate-audio", (req, res) => {
    const text = String(req.body?.text || "");
    for (const [id, r] of replies) if (r.text === text) return res.json({ audioUrl: `/api/voice/${id}.mp3` });
    res.status(404).json({ error: "only her own recent words can be voiced" });
});

app.use((req, res) => res.status(404).json({ error: "not found" }));
app.listen(PORT, HOST, () => log(`Scarlet Woman backend on http://${HOST}:${PORT} (claude-jail + piper)`));
