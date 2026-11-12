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
      providers: { gemini: false, openai: false, anthropic: false, elevenlabs: false, groq: false },
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

function normWordToken(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function appendChunkWithOverlapDedup(allSegments, allWords, chunkRes, offset, overlapSec) {
  const prevWordEnd = allWords.length ? allWords[allWords.length - 1].e : -1;
  const prevSegEnd = allSegments.length ? allSegments[allSegments.length - 1].e : -1;
  const rawWords = Array.isArray(chunkRes.words) && chunkRes.words.length
    ? chunkRes.words.map((w) => ({
        w: String(w.word ?? w.w ?? w.text ?? '').trim(),
        s: Number(w.start ?? w.s ?? 0) + offset,
        e: Math.max(Number(w.start ?? w.s ?? 0) + offset + 0.04, Number(w.end ?? w.e ?? 0) + offset),
      })).filter((w) => w.w)
    : [];

  const dedupedWords = [];
  for (const w of rawWords) {
    if (overlapSec > 0 && prevWordEnd > 0 && w.s < prevWordEnd + 0.35) {
      const recentTail = allWords.slice(-8);
      const dup = recentTail.some(
        (pw) => Math.abs(pw.s - w.s) < 1.2 && normWordToken(pw.w) && normWordToken(pw.w) === normWordToken(w.w)
      );
      if (dup || w.e <= prevWordEnd - 0.1) continue;
    }
    dedupedWords.push(w);
    allWords.push(w);
  }

  for (const seg of chunkRes.segments || []) {
    const s = Number(seg.s || 0) + offset;
    const e = Math.max(s + 0.05, Number(seg.e || 0) + offset);
    if (overlapSec > 0 && prevSegEnd > 0 && e <= prevSegEnd - 0.15) continue;
    const segWords = Array.isArray(seg.w)
      ? seg.w
          .map((word) => ({
            w: String(word.w ?? word.word ?? '').trim(),
            s: Number(word.s ?? word.start ?? 0) + offset,
            e: Math.max(Number(word.s ?? word.start ?? 0) + offset + 0.04, Number(word.e ?? word.end ?? 0) + offset),
          }))
          .filter((word) => word.w && (overlapSec <= 0 || prevWordEnd <= 0 || word.e > prevWordEnd - 0.1))
      : undefined;
    const text = segWords && segWords.length ? segWords.map((x) => x.w).join(' ').trim() : String(seg.t || '').trim();
    if (!text) continue;
    allSegments.push({
      s: prevSegEnd > 0 && s < prevSegEnd ? Math.max(s, prevSegEnd) : s,
      e,
      t: text,
      w: segWords && segWords.length ? segWords : undefined,
    });
  }
}

/**
 * Transcribes local Video/Audio entirely without uploading raw video:
 * 1) Extracts 16 kHz mono WAV chunks locally via Web Audio API (< 3.5 MB/chunk) with 4s overlap.
 * 2) Sends each lightweight audio chunk to /api/transcribe (Groq Whisper Large V3, ElevenLabs Scribe v2, or OpenAI Whisper).
 * 3) Retries failed chunks individually and merges/deduplicates timestamps chronologically.
 */
export async function transcribeMediaWeb({
  file,
  engine = 'groq',
  lang = 'auto',
  model = 'whisper-large-v3',
  maxWords = 12,
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
  const allWords = [];
  const allTexts = [];
  const failedChunks = [];
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

    let chunkJson = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0 && onProgress) {
          onProgress(basePct, `Retrying chunk ${i + 1}/${chunks.length} (attempt ${attempt + 1}/3)…`);
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
        if (r.ok) {
          chunkJson = j;
          break;
        }
        lastErr = new Error(j?.error || `Transcription HTTP ${r.status}`);
        if (![429, 502, 503, 504].includes(r.status)) break;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((res) => setTimeout(res, 1200 * 2 ** attempt));
    }

    if (!chunkJson) {
      failedChunks.push({ index: i + 1, error: lastErr?.message || String(lastErr) });
      continue;
    }

    appendChunkWithOverlapDedup(allSegments, allWords, chunkJson, ch.startOffsetSec, ch.overlapSec || 0);
    if (chunkJson.text) allTexts.push(chunkJson.text.trim());
  }

  if (!allSegments.length && failedChunks.length) {
    throw new Error(failedChunks[0].error || 'All transcription chunks failed.');
  }

  const warnSuffix = failedChunks.length ? ` (${failedChunks.length} chunk(s) skipped)` : '';
  if (onProgress) onProgress(100, `Transcribed ${allSegments.length} segments (${Math.round(duration)}s)${warnSuffix}.`);
  return { segments: allSegments, words: allWords, text: allTexts.join(' '), duration, failedChunks };
}
