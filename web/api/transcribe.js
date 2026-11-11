/**
 * POST /api/transcribe
 * Cloud ASR endpoint for browser-extracted lightweight audio chunks (<= 4.2 MB).
 * Supports ElevenLabs Scribe v2 (preferred for Arabic/Urdu/diarization) and OpenAI Whisper.
 */
function normalizeWordsToSegments(words = [], fallbackText = '', maxWords = 8) {
  const tokens = (words || []).filter((w) => w && String(w.text ?? w.word ?? '').trim() && (w.type ? w.type !== 'spacing' : true));
  if (!tokens.length) {
    const t = String(fallbackText || '').trim();
    return t ? [{ s: 0, e: 4, t, w: [] }] : [];
  }
  const segs = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((x) => x.w).join(' ').replace(/\s+/g, ' ').trim();
    segs.push({ s: cur[0].s, e: cur[cur.length - 1].e, t: text, w: [...cur] });
    cur = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const word = String(tk.text ?? tk.word ?? '').trim();
    const s = Number(tk.start ?? tk.s ?? 0);
    const e = Math.max(s + 0.05, Number(tk.end ?? tk.e ?? s + 0.2));
    const prevEnd = cur.length ? cur[cur.length - 1].e : s;
    const pauseGap = s - prevEnd;
    if (cur.length && (cur.length >= maxWords || pauseGap >= 0.7)) flush();
    cur.push({ w: word, s, e });
    if (/[.!?؟۔]$/.test(word) && cur.length >= 2) flush();
  }
  flush();
  return segs;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const engine = String(body?.engine || 'elevenlabs').toLowerCase();
  const audioB64 = String(body?.audioBase64 || '');
  const mime = String(body?.mimeType || 'audio/wav');
  const lang = String(body?.lang || '').trim();
  const model = String(body?.model || (engine === 'elevenlabs' ? 'scribe_v2' : 'whisper-1'));
  const maxWords = Math.max(3, Math.min(18, Number(body?.maxWords) || 8));
  const diarize = !!body?.diarize;
  const tagAudioEvents = !!body?.tagAudioEvents;

  if (!audioB64) return res.status(400).json({ error: 'Missing extracted audioBase64 payload' });
  const audioBuf = Buffer.from(audioB64, 'base64');
  if (audioBuf.length > 4_200_000) {
    return res.status(413).json({ error: 'Audio chunk exceeds 4.2 MB limit. Client should chunk longer audio.' });
  }

  const allowByok = process.env.WEB_ALLOW_BYOK !== 'false';
  const userKey = allowByok ? String(req.headers['x-user-api-key'] || '').trim() : '';

  try {
    if (engine === 'elevenlabs') {
      const apiKey = userKey || process.env.ELEVENLABS_API_KEY || '';
      if (!apiKey) {
        return res.status(401).json({
          code: 'NO_API_KEY',
          error: 'ELEVENLABS_API_KEY is not configured on Vercel and no user key was provided.',
        });
      }
      const fd = new FormData();
      fd.append('model_id', model || 'scribe_v2');
      fd.append('timestamps_granularity', 'word');
      if (lang && lang !== 'auto') fd.append('language_code', lang);
      if (diarize) fd.append('diarize', 'true');
      fd.append('tag_audio_events', tagAudioEvents ? 'true' : 'false');
      fd.append('file', new Blob([audioBuf], { type: mime }), 'audio.wav');

      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: j?.detail?.message || j?.detail || `ElevenLabs HTTP ${r.status}` });
      }
      const segments = normalizeWordsToSegments(j.words || [], j.text || '', maxWords);
      return res.status(200).json({ segments, text: j.text || '', language: j.language_code || lang });
    }

    // OpenAI Whisper fallback
    const oaKey = userKey || process.env.OPENAI_API_KEY || '';
    if (!oaKey) {
      return res.status(401).json({
        code: 'NO_API_KEY',
        error: 'OPENAI_API_KEY is not configured on Vercel and no user key was provided.',
      });
    }
    const fd = new FormData();
    fd.append('model', model || 'whisper-1');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    if (lang && lang !== 'auto') fd.append('language', lang);
    if (body?.prompt) fd.append('prompt', String(body.prompt).slice(0, 400));
    fd.append('file', new Blob([audioBuf], { type: mime }), 'audio.wav');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${oaKey}` },
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: j?.error?.message || `OpenAI Whisper HTTP ${r.status}` });
    }
    const segments = normalizeWordsToSegments(
      j.words || [],
      (j.segments || []).map((s) => s.text).join(' ') || j.text || '',
      maxWords
    );
    return res.status(200).json({ segments, text: j.text || '', language: j.language || lang });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
