import { ISLAMIC_TERM_MODES, TRSTYLE } from './constants.js';
import { getTauri } from './tauriBridge.js';

/**
 * Minbar-caption inspired AI & Segmentation Engine:
 * 1. Punctuation + silence gap lookback splitter (maxWords = 8 default, overlap-safe +-500ms padding)
 * 2. AI semantic word-boundary rearranger (REARRANGE_SYSTEM_PROMPT — immutable words)
 * 3. Conservative ASR proofreader (CORRECT_TRANSCRIPTION_SYSTEM_PROMPT)
 * 4. Context-aware subtitle translator with durationMs, pauseBeforeMs, contextGapBefore,
 *    Islamic terminology rules, Salawat rule, and explicit `issue` uncertainty field.
 */

export const REARRANGE_SYSTEM_PROMPT = `You are a multilingual subtitle editor, especially skilled in Arabic/Urdu sermons, poetry and nasheed.
Read the timeline in chronological order. Speech entries contain ORIGINAL words and timestamps in seconds, not existing subtitle segments.
Split each speech block into natural, readable units of meaning. Prefer complete clauses, coherent poetic lines and natural punctuation.
Avoid separating a particle, preposition, negation or conjunction from its complement, or leaving a tiny orphan fragment when a balanced alternative fits.
Never rewrite, add, or omit any word. Respect preferences.maxWords and preferences.maxDuration (seconds); a single prolonged spoken/sung word may exceed maxDuration.
Use the measured word start/end values to assess duration and pauses.
Return JSON only: {"blocks":[{"id":0,"ends":[4,8]}]}.
Return exactly one object for every input speech block, in input order, with its unchanged id.
ends are strictly increasing EXCLUSIVE word counts local to that block (equivalently the 1-based index of each segment's last word). The final end MUST equal that block's word count.`;

export const CORRECT_TRANSCRIPTION_SYSTEM_PROMPT = `You are a conservative multilingual speech-to-text proofreader, especially familiar with Arabic/Urdu sermons, poetry and nasheed.
Read all subtitles and their surrounding context. You have TEXT ONLY, not the recording: never claim to have heard or verified the audio.
Use corrections ONLY when both the transcription mistake and its intended replacement are almost certain (confidence >= 0.98). Look for nonsensical word substitutions, obvious speech-recognition confusions, and accidental repetitions supported by the surrounding sentence.
Do NOT polish valid phrasing, fix punctuation alone, invent missing words, translate, or substitute a familiar quote merely because it sounds similar.
For every clearly garbled passage whose replacement is uncertain, return a warning with its exact original text and a plausible contextual reconstruction in suggestion (never placeholders like [unclear]). Explain briefly in reason.
A subtitle ID may appear in corrections OR warnings, never both. Omit clean subtitles.
Return JSON only: {"corrections":[{"id":1,"before":"exact text","after":"minimally fixed text","reason":"Why this is a likely ASR confusion.","confidence":0.99}],"warnings":[{"id":2,"text":"exact text","suggestion":"plausible contextual guess","reason":"Contextual guess; listen to verify actual words."}]}`;

export function buildProjectTranslationSystemPrompt(trCfg, isPoetry) {
  const tgt = (trCfg.tgt || 'English').trim();
  const src = trCfg.src === 'auto' ? 'the source language' : trCfg.src;
  const outLang = trCfg.mode === 'proofread' ? src : tgt;
  return `You are an expert subtitle translator and editor producing fluent, natural ${outLang} captions for social/educational videos, lessons, sermons, poetry, or recitations.

Read the entire chronological timeline before translating. Work out sentence structure, reported speech, quotations, and terminology across subtitle boundaries, then produce the translation for each item. Do not treat a display cut or pause as an automatic sentence ending.

FAITHFULNESS AND TIMING
- Preserve the speaker's substantive meaning, viewpoint, names, emphasis, and tone. Do not summarize, censor, or insert unrequested explanations.
- Translate idiomatically rather than copying source syntax. If a subtitle has an obvious ASR garble unambiguous from context, translate the intended meaning AND mention the contextual guess concisely in "issue" for review (never put "[unclear]" or bracketed notes inside "t").
- Each item shows "durationMs" and "pauseBeforeMs". Prefer concise, natural wording readable within durationMs (~${trCfg.cps || 17} chars/sec target) without sacrificing meaning.
- "contextGapBefore": true indicates omitted intervening lines: treat it as a continuity boundary.
- Keep punctuation and capitalization flowing naturally across continuing clauses rather than capitalizing/ending every fragment unnecessarily.

TERMINOLOGY & QUOTATIONS
- ${ISLAMIC_TERM_MODES[trCfg.islamicTermMode || 'both'] || ISLAMIC_TERM_MODES.both}
- ${
    trCfg.useSalawatSymbol !== false
      ? 'Render routine prayers and blessings specifically for Prophet Muhammad as ﷺ without duplicating it; translate blessings on other people in full.'
      : 'Write prayers and blessings on Prophet Muhammad in full in the target language.'
  }
- Style guideline: ${TRSTYLE[trCfg.style] || TRSTYLE.natural}
${isPoetry || trCfg.poetry ? '- Poetry / Qasida mode: preserve poetic imagery, elevated rhythm, and explicit verse line breaks (\\n) between couplet halves.\n' : ''}${
    trCfg.brk ? '- If a single cue runs long, insert up to 2 " | " reveal markers at natural spoken pauses.\n' : ''
  }
OUTPUT CONTRACT
- Return ONLY a valid JSON object: {"items":[{"i":<id>,"t":"<translated text>","issue":""}]}
- Include every item ID "i" from ITEMS_TO_PROCESS in exact order. "issue" must be "" for normal lines or a concise review note for contextual guesses.`;
}

export function buildProjectTranslationUserPrompt(trCfg, items, fullContext, recentPairs, isPoetry) {
  const tgt = (trCfg.tgt || 'English').trim();
  const src = trCfg.src === 'auto' ? 'the source language (detect it)' : trCfg.src;
  const task =
    trCfg.mode === 'proofread'
      ? `Proofread these ${src} ASR subtitles in the SAME language: fix only clear recognition mistakes while keeping boundaries.`
      : trCfg.mode === 'both'
        ? `Silently resolve clear ASR slips in ${src}, then translate faithfully into ${tgt}.`
        : `Translate these subtitles from ${src} into ${tgt}.`;

  const rules = [
    `Return {"items":[...]} with exactly ${items.length} entries matching every "i" integer.`,
    `Never invent or copy untranslated source words unless it is a proper noun or glossary term.`,
  ];
  const g = (trCfg.gloss || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (g.length) rules.push('Glossary (follow strictly):\n' + g.join('\n'));
  if ((trCfg.extraPrefs || '').trim()) {
    rules.push('User editorial preferences: ' + trCfg.extraPrefs.trim());
  }

  const mem = recentPairs?.length
    ? '\nRecent approved translations (maintain identical terminology & tone):\n' +
      recentPairs.map((p) => `- "${p.s}" => "${p.t}"`).join('\n')
    : '';
  const ctx = fullContext
    ? `\nSURROUNDING TRANSCRIPT CONTEXT (read-only continuity — do NOT output):\n${fullContext}`
    : '';
  if (isPoetry || trCfg.poetry) {
    rules.push('Preserve poetic couplet line breaks (\\n) when present.');
  }

  return `${task}\n\nRules:\n- ${rules.join('\n- ')}${mem}${ctx}\n\nITEMS_TO_PROCESS:\n${JSON.stringify(items)}`;
}

/* ---------- Text & Subtitle Segmentation Helpers ---------- */

export function synthWords(g) {
  const tk = (g.t || '').split(/\s+/).filter(Boolean);
  const tot = tk.reduce((n, w) => n + w.length + 1, 0) || 1;
  const d = Math.max(0.05, (Number(g.e) || 0) - (Number(g.s) || 0));
  let c = Number(g.s) || 0;
  return tk.map((w) => {
    const e = c + (d * (w.length + 1)) / tot;
    const o = { w, s: c, e };
    c = e;
    return o;
  });
}

export function normalizeArabicSubtitlePunctuation(text) {
  if (!text || !text.includes('?')) return text;
  const letters = text.match(/\p{L}/gu);
  return letters?.length && letters.every((l) => /\p{Script_Extensions=Arabic}/u.test(l))
    ? text.replace(/\?/gu, '؟')
    : text;
}

export function cleanWordList(g) {
  const raw = g.w && g.w.length ? g.w : synthWords(g);
  return raw
    .map((w) => ({
      w: String(w.w || '').trim(),
      s: Number(w.s) || 0,
      e: Math.max((Number(w.s) || 0) + 0.02, Number(w.e) || (Number(w.s) || 0) + 0.2),
    }))
    .filter((w) => w.w);
}

/**
 * Minbar-caption style boundary splitter:
 * - Honors maxWords (default 8), maxChars, and maxDur without splitting a single long word
 * - Looks back for the strongest boundary score (punctuation + silence gap >= 0.25s)
 */
export function splitByLimits(words, maxChars = 42, maxWords = 8, maxDur = 6, nextId = () => Date.now() + Math.random()) {
  if (!words.length) return [];
  const out = [];
  let start = 0;

  while (start < words.length) {
    let cut = start + 1;
    let chars = words[start].w.length;

    while (cut < words.length) {
      const w = words[cut];
      const nextChars = chars + 1 + w.w.length;
      const nextWords = cut - start + 1;
      const nextDur = w.e - words[start].s;
      const gap = w.s - words[cut - 1].e;

      if (maxWords > 0 && nextWords > maxWords) break;
      if (maxChars > 0 && nextChars > maxChars) break;
      if (maxDur > 0 && nextDur > maxDur) break;
      if (gap >= 0.85 && cut - start >= 2) break;

      chars = nextChars;
      cut++;
    }

    // Look back slightly to align splits with punctuation or natural speech pauses when mid-block
    if (cut < words.length && cut - start >= 3) {
      let bestScore = 0;
      const minKeep = start + Math.max(2, Math.floor((cut - start) * 0.45));
      for (let i = minKeep; i <= cut; i++) {
        const gap = Math.max(0, words[i].s - words[i - 1].e);
        const punct = /[.!?؟،,;؛:…۔]$/u.test(words[i - 1].w) ? 2.0 : 0;
        const score = punct + (gap >= 0.25 ? Math.min(1.5, gap) : 0);
        if (score >= bestScore && score > 0) {
          bestScore = score;
          cut = i;
        }
      }
    }

    const part = words.slice(start, cut);
    const rawS = part[0].s;
    const rawE = part[part.length - 1].e;
    const joined = normalizeArabicSubtitlePunctuation(part.map((w) => w.w).join(' '));
    out.push({
      id: nextId(),
      s: rawS,
      e: rawE,
      rawS,
      rawE,
      t: joined,
      words: part.map((w) => ({ w: w.w, s: w.s, e: w.e })),
    });
    start = cut;
  }

  return out;
}

export function segsToSubs(segs, maxChars = 42, maxWords = 8, maxDur = 6, nextId) {
  const out = [];
  const hasLimits = maxChars > 0 || maxWords > 0 || maxDur > 0;
  for (const g of segs || []) {
    const ws = cleanWordList(g);
    if (!ws.length) {
      const rs = Number(g.s) || 0;
      const re = Number(g.e) || 0;
      if ((g.t || '').trim()) {
        out.push({
          id: nextId(),
          s: rs,
          e: re,
          rawS: rs,
          rawE: re,
          t: normalizeArabicSubtitlePunctuation(String(g.t).trim()),
          words: [],
        });
      }
      continue;
    }
    if (hasLimits) {
      out.push(...splitByLimits(ws, maxChars, maxWords, maxDur, nextId));
    } else {
      const rs = Number(g.s) || ws[0].s;
      const re = Number(g.e) || ws[ws.length - 1].e;
      out.push({
        id: nextId(),
        s: rs,
        e: re,
        rawS: rs,
        rawE: re,
        t: normalizeArabicSubtitlePunctuation(ws.map((w) => w.w).join(' ')),
        words: ws,
      });
    }
  }
  return out;
}

/**
 * Applies non-compounding, overlap-safe before/after timing padding (default 500ms / 500ms).
 * Anchors to `rawS` and `rawE` so repeated calls never accumulate padding.
 */
export function applySubtitlePadding(subs, padBeforeMs = 500, padAfterMs = 500, totalDur = 0) {
  const items = [...(subs || [])]
    .map((o) => ({ ...o }))
    .sort((a, b) => (a.rawS ?? a.s) - (b.rawS ?? b.s));
  if (!items.length) return [];
  const padB = Math.max(0, Number(padBeforeMs) || 0) / 1000;
  const padA = Math.max(0, Number(padAfterMs) || 0) / 1000;

  for (const o of items) {
    const bs = Number(o.rawS !== undefined ? o.rawS : o.s) || 0;
    const be = Math.max(bs + 0.05, Number(o.rawE !== undefined ? o.rawE : o.e) || bs + 0.05);
    o.rawS = bs;
    o.rawE = be;
  }

  const sumPad = Math.max(0.001, padB + padA);
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    const prev = i > 0 ? items[i - 1] : null;
    const nx = i + 1 < items.length ? items[i + 1] : null;

    let newS = Math.max(0, o.rawS - padB);
    if (prev) {
      const prevGap = o.rawS - prev.rawE;
      if (prevGap >= 0 && prevGap < padB + padA) {
        const boundary = prev.rawE + prevGap * (padA / sumPad);
        newS = Math.max(newS, boundary, prev.e);
      } else if (prevGap < 0) {
        newS = Math.max(o.rawS, prev.e);
      } else {
        newS = Math.max(newS, prev.e);
      }
    }

    let newE = o.rawE + padA;
    if (totalDur > 0) newE = Math.min(totalDur, newE);
    if (nx) {
      const nextGap = nx.rawS - o.rawE;
      if (nextGap >= 0 && nextGap < padB + padA) {
        const boundary = o.rawE + nextGap * (padA / sumPad);
        newE = Math.min(newE, boundary);
      } else if (nextGap < 0) {
        newE = Math.min(newE, Math.max(o.rawE, nx.rawS));
      } else {
        newE = Math.min(newE, nx.rawS);
      }
    }

    o.s = +newS.toFixed(3);
    o.e = +Math.max(o.s + 0.05, newE).toFixed(3);
  }

  return items;
}

export function mergeSentenceSubtitles(items, limits = {}) {
  const out = [];
  const ends = /[.!?؟۔…:;؛।]$/;
  const maxC = Number(limits.maxChars) || 0;
  const maxW = Number(limits.maxWords) || 8;
  const maxD = Number(limits.maxDur) || 9;

  for (const raw of items || []) {
    const cur = { ...raw, t: String(raw.t || '').trim() };
    if (!cur.t) continue;
    if (!out.length) {
      out.push(cur);
      continue;
    }
    const prev = out[out.length - 1];
    const gap = Math.max(0, (Number(cur.rawS ?? cur.s) || 0) - (Number(prev.rawE ?? prev.e) || 0));
    const comb = (prev.t + ' ' + cur.t).replace(/\s+/g, ' ').trim();
    const words = comb.split(/\s+/);
    const overChars = maxC > 0 && comb.length > maxC;
    const overWords = maxW > 0 && words.length > maxW;
    const overDur = (Number(cur.rawE ?? cur.e) - Number(prev.rawS ?? prev.s)) > maxD;
    if (ends.test(prev.t) || gap >= 0.85 || overChars || overWords || overDur) {
      out.push(cur);
    } else {
      prev.t = comb;
      prev.e = cur.e;
      prev.rawE = cur.rawE ?? cur.e;
      if (prev.words && cur.words) prev.words.push(...cur.words);
    }
  }
  return out;
}

export function applyGenreSegmentation(items, genre, limits = {}) {
  const src = (items || []).map((x) => ({ ...x, t: String(x.t || '').trim() })).filter((x) => x.t);
  const mc = Number(limits.maxChars) || 0;
  const mw = Number(limits.maxWords) || 0;
  const md = Number(limits.maxDur) || 0;

  if (genre === 'poetry') {
    const out = [];
    for (const cur of src) {
      if (!out.length) {
        out.push(cur);
        continue;
      }
      const prev = out[out.length - 1];
      const gap = (Number(cur.s) || 0) - (Number(prev.e) || 0);
      const comb = (prev.t + ' ' + cur.t).trim();
      const words = comb.split(/\s+/);
      const punctuation = /[.!?؟۔…،؛:]$/.test(prev.t);
      const fitsChars = !mc || comb.length <= mc;
      const fitsWords = !mw || words.length <= mw;
      const fitsDur = !md || Number(cur.e) - Number(prev.s) <= md;
      if (!punctuation && gap < 0.22 && words.length <= 14 && comb.length <= 95 && fitsChars && fitsWords && fitsDur) {
        prev.t = comb;
        prev.e = cur.e;
        prev.rawE = cur.rawE ?? cur.e;
        if (prev.words && cur.words) prev.words.push(...cur.words);
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  const merged = mergeSentenceSubtitles(src, limits);
  if (genre === 'religious') {
    const cues =
      /(?:قال رسول الله|قال النبي|عن النبي|عن رسول الله|حديث(?:اً|ا)?|قال الصحابي|رضي الله عنه(?:ا)? قال|فرمایا رسول اللہ|رسول اللہ نے فرمایا|نبی کریم ﷺ نے فرمایا|حدیث میں آتا ہے|حضرت .* نے فرمایا)/u;
    const out = [];
    for (const item of merged) {
      const m = item.t.match(cues);
      if (m && m.index > 0) {
        const head = item.t.slice(0, m.index).trim();
        const quote = item.t.slice(m.index).trim();
        const mid = item.s + ((item.e - item.s) * head.length) / item.t.length;
        if (head) out.push({ ...item, t: head, e: mid, rawE: mid });
        if (quote) out.push({ ...item, t: quote, s: mid, rawS: mid });
      } else {
        out.push(item);
      }
    }
    return out;
  }
  return merged;
}

/* ---------- AI HTTP & JSON Parsing Helpers ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function extractJsonValue(rawText) {
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
    if (!slice) throw new Error('AI response did not contain JSON');
    slice = slice.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(slice);
  }
}

export async function aiHttpWithRetry(makeRequest, onNote) {
  for (let attempt = 0; ; attempt++) {
    const r = await makeRequest();
    if (r.ok) return r;
    if ([429, 500, 502, 503, 504].includes(r.status) && attempt < 4) {
      const waitMs = 1500 * 2 ** attempt;
      if (onNote) onNote(`Rate limited or busy (${r.status}) — waiting ${Math.round(waitMs / 1000)}s…`);
      await sleep(waitMs);
      continue;
    }
    let j = {};
    try {
      j = await r.json();
    } catch {}
    throw new Error(j?.error?.message || (Array.isArray(j) && j[0]?.error?.message) || 'HTTP ' + r.status);
  }
}

export async function aiCallJson({ prov, url, key, model, temp = 0.15 }, prompt, systemMsg = '', onNote) {
  const ta = getTauri();
  const f = ta?.http?.fetch || fetch;
  const base = String(url || '').replace(/\/$/, '');
  if (!key && prov !== 'ollama') throw new Error('Add your API key first.');
  if (!base) throw new Error('AI base URL is empty.');

  let txt = '';
  if (prov === 'gemini' && !/\/openai$/.test(base)) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: temp, responseMimeType: 'application/json' },
      safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({
        category: 'HARM_CATEGORY_' + c,
        threshold: 'BLOCK_ONLY_HIGH',
      })),
    };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };
    const r = await aiHttpWithRetry(
      () =>
        f(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
        }),
      onNote
    );
    const j = await r.json();
    if (j.promptFeedback?.blockReason) throw new Error('Blocked by Gemini: ' + j.promptFeedback.blockReason);
    const c = j.candidates?.[0];
    txt = (c?.content?.parts || []).map((p) => p.text || '').join('');
    if (!txt) throw new Error('Empty answer (' + (c?.finishReason || 'no candidates') + ')');
  } else if (prov === 'anthropic') {
    const body = { model, max_tokens: 8000, temperature: temp, messages: [{ role: 'user', content: prompt }] };
    if (systemMsg) body.system = systemMsg;
    const r = await aiHttpWithRetry(
      () =>
        f(`${base}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        }),
      onNote
    );
    const j = await r.json();
    txt = (j.content || []).map((c) => c.text || '').join('');
  } else {
    const messages = systemMsg ? [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
    const r = await aiHttpWithRetry(
      () =>
        f(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
          body: JSON.stringify({ model, temperature: temp, messages }),
        }),
      onNote
    );
    const j = await r.json();
    txt = j.choices?.[0]?.message?.content || '';
  }

  return extractJsonValue(txt);
}

/**
 * Minbar-caption style AI Semantic Boundary Rearranger:
 * Keeps original timed words 100% immutable and only rearranges split boundaries into natural clauses.
 */
export async function aiSemanticRearrange(subs, aiCfg, limits, onNote) {
  const words = [];
  for (const s of [...subs].sort((a, b) => (a.rawS ?? a.s) - (b.rawS ?? b.s))) {
    const ws = cleanWordList({ s: s.rawS ?? s.s, e: s.rawE ?? s.e, t: s.orig !== undefined ? s.orig : s.t, w: s.words });
    words.push(...ws);
  }
  if (!words.length) throw new Error('No timed words available to rearrange.');

  const payload = {
    preferences: { maxWords: limits.maxWords || 8, maxDuration: limits.maxDur || 6 },
    blocks: [
      {
        id: 0,
        words: words.map((w, i) => ({
          i: i + 1,
          w: w.w,
          s: +w.s.toFixed(3),
          e: +w.e.toFixed(3),
        })),
      },
    ],
  };

  if (onNote) onNote('AI rearranging subtitle phrasing cleanly…');
  const res = await aiCallJson(
    aiCfg,
    `Split this word sequence into natural subtitle segments.\n\nINPUT:\n${JSON.stringify(payload)}`,
    REARRANGE_SYSTEM_PROMPT,
    onNote
  );

  const blk = (res?.blocks || []).find((b) => +b.id === 0) || res?.blocks?.[0];
  const ends = blk?.ends;
  if (
    !Array.isArray(ends) ||
    !ends.length ||
    ends[ends.length - 1] !== words.length ||
    ends.some((end, i) => !Number.isInteger(end) || end <= (ends[i - 1] ?? 0) || end > words.length)
  ) {
    throw new Error('AI returned invalid boundary indexes; keeping current segmentation.');
  }

  const out = [];
  let prevEnd = 0;
  for (const end of ends) {
    const slice = words.slice(prevEnd, end);
    prevEnd = end;
    const rs = slice[0].s;
    const re = slice[slice.length - 1].e;
    out.push({
      s: rs,
      e: re,
      rawS: rs,
      rawE: re,
      t: normalizeArabicSubtitlePunctuation(slice.map((x) => x.w).join(' ')),
      words: slice,
    });
  }
  return out;
}

/**
 * Minbar-caption style Conservative ASR Proofreader:
 * Applies high-confidence fixes (>=0.98) and marks ambiguous passages with review warnings.
 */
export async function aiProofreadAsr(subs, aiCfg, onNote) {
  if (!subs.length) throw new Error('No subtitles to proofread.');
  const payload = {
    language: 'English',
    subtitles: subs.map((s) => ({
      id: s.id,
      editable: true,
      text: s.orig !== undefined ? s.orig : s.t,
    })),
  };
  if (onNote) onNote('Scanning transcript for ASR confusions…');
  const res = await aiCallJson(
    aiCfg,
    `Inspect these subtitles conservatively for clear ASR confusions.\n\nINPUT:\n${JSON.stringify(payload)}`,
    CORRECT_TRANSCRIPTION_SYSTEM_PROMPT,
    onNote
  );
  return {
    corrections: Array.isArray(res?.corrections) ? res.corrections : [],
    warnings: Array.isArray(res?.warnings) ? res.warnings : [],
  };
}
