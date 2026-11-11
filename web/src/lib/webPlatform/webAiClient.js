import { extractAsrWavChunks, uint8ToBase64 } from './webAudioTools.js';

let cachedHealth = null;

export async function fetchServerHealth(force = false) {
  if (cachedHealth && !force) return cachedHealth;
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    cachedHealth = await r.json();
    return cachedHealth;
  } catch {
    return {
      ok: false,
      runtime: 'offline-static',
      allowByok: true,
      maxUploadBytes: 4_200_000,
      providers: { gemini: false, openai: false, anthropic: false, elevenlabs: false },
    };
  }
}

export function extractJsonValueWeb(rawText) {
  let t = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const objA = t.indexOf('{');
    const objB = t.lastIndexOf('}');
    const arrA = t.indexOf('[');
    const arrB = t.lastIndexOf(']');
    let slice = '';
    if (objA >= 0 && objB > objA && (arrA < 0 || objA < arrA)) slice = t.slice(objA, objB + 1);
    else if (arrA >= 0 && arrB > arrA) slice = t.slice(arrA, arrB + 1);
    if (!slice) throw new Error('AI response did not contain valid JSON');
    slice = slice.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(slice);
  }
}

/**
 * Calls Vercel /api/ai serverless proxy (server env keys preferred, optional BYOK fallback header).
 * Falls back to direct fetch ONLY when running against a user-supplied custom HTTPS endpoint in static preview.
 */
export async function webAiCallJson({ prov = 'gemini', url = '', key = '', model = '', temp = 0.15 }, prompt, systemMsg = '', onNote) {
  const cleanKey = String(key || '').trim();
  const headers = { 'content-type': 'application/json' };
  if (cleanKey) headers['x-user-api-key'] = cleanKey;

  for (let attempt = 0; ; attempt++) {
    if (onNote && attempt > 0) onNote(`Retrying AI request (attempt ${attempt + 1})…`);
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prov, url, model, temp, prompt, systemMsg, expectJson: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.text) {
      return extractJsonValueWeb(j.text);
    }
    if ([429, 502, 503, 504].includes(r.status) && attempt < 3) {
      await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
      continue;
    }
    throw new Error(j?.error || `AI request failed (HTTP ${r.status})`);
  }
}

/**
 * Transcribes local Video/Audio entirely without uploading raw video:
 * 1) Extracts 16 kHz mono WAV chunks locally via Web Audio API (< 3.5 MB/chunk).
 * 2) Sends each lightweight audio chunk to /api/transcribe (ElevenLabs Scribe v2 or OpenAI Whisper).
 * 3) Merges timestamps seamlessly across all chunks.
 */
export async function transcribeMediaWeb({
  file,
  engine = 'elevenlabs',
  lang = 'auto',
  model = 'scribe_v2',
  maxWords = 8,
  diarize = false,
  tagAudioEvents = false,
  prompt = '',
  userKey = '',
  onProgress,
}) {
  if (!file) throw new Error('Select a video or audio file first.');
  const { chunks, duration } = await extractAsrWavChunks(file, onProgress);
  if (!chunks.length) throw new Error('Could not extract audio samples from this file.');

  const allSegments = [];
  const allTexts = [];
  const headers = { 'content-type': 'application/json' };
  if (String(userKey || '').trim()) headers['x-user-api-key'] = String(userKey).trim();

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const basePct = 30 + Math.round((i / chunks.length) * 65);
    if (onProgress) {
      onProgress(
        basePct,
        `Cloud ASR chunk ${i + 1}/${chunks.length} (${Math.round(ch.durationSec)}s extracted audio)…`
      );
    }
    const r = await fetch('/api/transcribe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        engine,
        lang,
        model,
        maxWords,
        diarize,
        tagAudioEvents,
        prompt,
        mimeType: 'audio/wav',
        audioBase64: uint8ToBase64(ch.wavBytes),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(j?.error || `Transcription HTTP ${r.status}`);
    }
    const offset = ch.startOffsetSec;
    for (const seg of j.segments || []) {
      allSegments.push({
        s: Number(seg.s || 0) + offset,
        e: Number(seg.e || 0) + offset,
        t: String(seg.t || '').trim(),
        w: Array.isArray(seg.w)
          ? seg.w.map((word) => ({ w: word.w, s: Number(word.s || 0) + offset, e: Number(word.e || 0) + offset }))
          : undefined,
      });
    }
    if (j.text) allTexts.push(j.text.trim());
  }

  if (onProgress) onProgress(100, `Transcribed ${allSegments.length} segments (${Math.round(duration)}s).`);
  return { segments: allSegments, text: allTexts.join(' '), duration };
}
