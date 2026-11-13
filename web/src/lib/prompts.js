import { ISLAMIC_TERM_MODES, TRSTYLE } from './constants.js';
import { webAiCallJson } from './webPlatform/webAiClient.js';
import { autoRepairCues, intelligentSemanticSegment } from './transcriptEngine/semanticSegmenter.js';

/**
 * Intelligent Subtitle Segmentation 2.0 & Translation Engine:
 * 1. 3-Pass Semantic Segmentation (Discourse reconstruction, DP clause slicing, Auto-Repair)
 * 2. AI semantic word-boundary rearranger (REARRANGE_SYSTEM_PROMPT — Baian AI inspired)
 * 3. Conservative ASR proofreader (CORRECT_TRANSCRIPTION_SYSTEM_PROMPT)
 * 4. Context-aware subtitle translator with durationMs, pauseBeforeMs, contextGapBefore,
 *    Islamic terminology rules, Salawat rule, and explicit `issue` uncertainty field.
 */

export const REARRANGE_SYSTEM_PROMPT = `You are an elite multilingual subtitle editor inspired by Baian AI and broadcast subtitling standards (Arabic, Urdu, and English).
Your task is to divide speech into grammatically complete, natural, and fluent subtitle segments.

CORE OBJECTIVE:
- Each subtitle cue MUST represent a coherent unit of thought.
- Preferred cue length: 8–12 words. (Acceptable range: 6–14 words).
- Standalone short sentences (e.g. 5-10 words) MUST be preserved as a single cue, NEVER chopped into pieces!
  Example: "So Islam itself is a complete framework of noble character." is ONE cue (10 words), NEVER split!

STRICT GRAMMATICAL INTEGRITY RULES:
1. NEVER cut between a Subject and its Verb / Copula.
   BAD: [So Islam itself] | [is a complete framework of noble character.]
   GOOD: [So Islam itself is a complete framework of noble character.]
2. NEVER leave a preposition, article, or conjunction stranded at the end of a subtitle cue (e.g. "of", "in", "to", "for", "with", "the", "a", "an", "that", "کا", "کی", "کے", "میں", "في", "من", "على").
3. NEVER start a subtitle cue with an orphaned relative pronoun or subordinating particle without its clause (e.g. starting with "that they accepted Islam" when separated from the main clause).
4. NEVER separate names from titles or honorifics:
   - "The Prophet Muhammad ﷺ" MUST stay together.
   - "صلى الله عليه وسلم", "رضي الله عنه" must never be isolated on their own line.
5. In compound sentences, split ONLY at major clause conjunctions (and, but, however, because, while) where both parts form complete, readable thoughts.

OUTPUT CONTRACT:
Return JSON only: {"blocks":[{"id":0,"ends":[10,21]}]}.
ends are strictly increasing 1-based exclusive word counts for each subtitle boundary. The last end MUST equal the total word count.`;

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
- CRITICAL HONORIFIC PLACEMENT: In English sentences, NEVER place an Arabic honorific (such as ﷺ, صلى الله عليه وسلم, رضي الله عنه, رحمه الله) at the beginning of the sentence. Always place the honorific immediately after the relevant name or title (e.g. "The companions of the Prophet ﷺ", "Abu Bakr رضي الله عنه", "Imam Bukhari رحمه الله"). Never detach or displace honorifics.
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

const GLUE_TRAILING = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'some', 'any', 'no', 'every', 'each', 'another', 'such',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'to', 'into', 'onto', 'upon', 'about',
  'between', 'among', 'through', 'towards', 'toward', 'under', 'over', 'against', 'during', 'without', 'within',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'and', 'or', 'but', 'nor', 'yet', 'so', 'if', 'because', 'since', 'while', 'when', 'where',
  'who', 'whom', 'whose', 'which', 'although', 'though', 'unless', 'until',
  'prophet', 'imam', 'sheikh', 'shaykh', 'ustadh', 'ustad', 'maulana', 'hazrat', 'saint', 'dr', 'mr', 'mrs',
  'في', 'من', 'إلى', 'الى', 'على', 'عن', 'مع', 'عند', 'بين', 'حتى', 'أن', 'إن', 'أنّ', 'إنّ',
  'لا', 'لم', 'لن', 'قد', 'ما', 'هذا', 'هذه', 'ذلك', 'تلك', 'يا', 'عبد', 'بن', 'ابن', 'أبو', 'ابو', 'أبي', 'ابي',
  'رسول', 'نبي', 'صلى', 'عليه', 'رضي', 'عنها', 'و', 'أو', 'ثم', 'لكن', 'لأن', 'بل',
  'اور', 'یا', 'لیکن', 'مگر', 'کیونکہ', 'کہ', 'جب', 'اگر', 'تاکہ', 'چونکہ', 'حضرت', 'نبی', 'کریم', 'رسول', 'مولانا',
]);

const CLAUSE_STARTERS = new Set([
  'and', 'or', 'but', 'because', 'since', 'while', 'when', 'where', 'which', 'that', 'who', 'whom', 'whose',
  'so', 'then', 'therefore', 'however', 'to', 'towards', 'toward', 'for', 'with', 'from', 'upon', 'into',
  'without', 'within', 'through', 'during', 'before', 'after', 'until', 'unless', 'although',
  'و', 'ف', 'ثم', 'أو', 'او', 'بل', 'لكن', 'لأن', 'لان', 'الذي', 'التي', 'الذين', 'حتى', 'من', 'إلى', 'الى', 'على', 'في',
  'اور', 'یا', 'لیکن', 'مگر', 'کیونکہ', 'کہ', 'جو', 'جس', 'جب', 'تو', 'تاکہ', 'پھر',
]);

const PHRASE_HEAD_DET = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'our', 'your', 'my']);

const URDU_POSTPOSITIONS = new Set([
  'نے', 'کو', 'سے', 'میں', 'پر', 'کا', 'کی', 'کے', 'تک', 'لیے', 'لئے', 'والا', 'والی', 'والے',
  'ہے', 'ہیں', 'تھا', 'تھی', 'تھے', 'ہو', 'ہوں', 'گا', 'گی', 'گے', 'گیا', 'گئی', 'گئے',
]);

const HONORIFIC_NEXT = new Set(['ﷺ', '(pbuh)', 'pbuh', '(saw)', '(saww)', '(ra)', '(as)', 'تعالى', 'سبحانه', 'عليه', 'وسلم']);

const normTok = (raw) =>
  String(raw || '')
    .toLowerCase()
    .replace(/^[\s"'“”‘’(\[{«]+|[\s"'“”‘’)\]}.!?؟،,;؛:…۔»]+$/gu, '')
    .trim();

const isSentencePunct = (w) => /[.!?؟۔…।]$/u.test(String(w || '').trim());
const isClausePunct = (w) => /[,،;؛:—–-]$/u.test(String(w || '').trim());

function scoreBoundaryTransition(words, i, j, prefMin, prefMax, accMin, maxChars, maxDur) {
  const n = j - i;
  const dur = words[j - 1].e - words[i].s;
  const chars = words.slice(i, j).reduce((sum, x) => sum + x.w.length, 0) + Math.max(0, n - 1);
  const gap = j < words.length ? Math.max(0, words[j].s - words[j - 1].e) : 0;
  const endPunct = isSentencePunct(words[j - 1].w);
  const clausePunct = isClausePunct(words[j - 1].w);
  const startsFresh = i === 0 || isSentencePunct(words[i - 1].w) || Math.max(0, words[i].s - words[i - 1].e) >= 0.65;

  let score = 0;

  const targetMid = (prefMin + prefMax) * 0.5;
  if (n >= prefMin && n <= prefMax) {
    score += 4.6 - Math.abs(n - targetMid) * 0.25;
  } else if (n >= accMin && n <= prefMax + 2) {
    score += 1.6 - Math.abs(n - targetMid) * 0.2;
  } else if (n < accMin) {
    const validShortSentence = startsFresh && (endPunct || j === words.length || gap >= 0.65) && n >= 2;
    score += validShortSentence ? 2.8 : -4.8 * (accMin - n);
  } else {
    score -= (n - prefMax) * 1.4;
  }

  if (maxChars > 0 && chars > maxChars) score -= (chars - maxChars) * 0.32;
  if (maxDur > 0 && dur > maxDur) score -= (dur - maxDur) * 1.6;

  if (j < words.length) {
    const rawPrev = words[j - 1].w;
    const rawNext = words[j].w;
    const prev = normTok(rawPrev);
    const next = normTok(rawNext);

    if (endPunct) score += 9.5;
    else if (clausePunct) score += 4.8;

    if (gap >= 0.7) score += 6.2;
    else if (gap >= 0.35) score += 3.6;
    else if (gap >= 0.18 && n >= accMin) score += 1.3;

    if (!endPunct) {
      if (GLUE_TRAILING.has(prev)) score -= 7.8;
      if (HONORIFIC_NEXT.has(next) || rawNext.includes('ﷺ')) score -= 9.5;
      if (prev === 'prophet' && /^muhammad/i.test(next)) score -= 9.0;
      if (URDU_POSTPOSITIONS.has(next)) score -= 7.2;
      if (CLAUSE_STARTERS.has(next) && n >= 4) score += 2.9;
      else if (PHRASE_HEAD_DET.has(next) && !GLUE_TRAILING.has(prev) && n >= Math.max(5, accMin)) score += 1.4;
    }
  }

  return score;
}

function segmentRunWithDP(run, maxChars, maxWords, maxDur, nextId) {
  if (!run.length) return [];
  const rawMaxW = Number(maxWords) || 0;
  const strictCeiling = rawMaxW > 0 && rawMaxW <= 9;
  const prefMin = rawMaxW > 0 ? (strictCeiling ? Math.min(rawMaxW, Math.max(4, rawMaxW - 2)) : Math.max(6, Math.min(8, rawMaxW - 2))) : 8;
  const prefMax = rawMaxW > 0 ? rawMaxW : 12;
  const accMin = Math.max(3, prefMin - 2);
  const hardMaxW = rawMaxW > 0 ? (strictCeiling ? rawMaxW : Math.max(prefMax + 2, 14)) : 16;

  if (run.length <= hardMaxW) {
    const singleChars = run.reduce((s, x) => s + x.w.length, 0) + Math.max(0, run.length - 1);
    const singleDur = run[run.length - 1].e - run[0].s;
    const fitsMaxC = !maxChars || singleChars <= maxChars;
    const fitsMaxW = strictCeiling ? run.length <= rawMaxW : run.length <= prefMax;
    const fitsDur = !maxDur || singleDur <= maxDur;
    if (fitsMaxW && fitsMaxC && fitsDur) {
      const rs = run[0].s;
      const re = run[run.length - 1].e;
      return [{
        id: nextId(),
        s: rs,
        e: re,
        rawS: rs,
        rawE: re,
        t: normalizeArabicSubtitlePunctuation(run.map((w) => w.w).join(' ')),
        words: run.map((w) => ({ w: w.w, s: w.s, e: w.e })),
      }];
    }
  }

  const N = run.length;
  const dp = new Float64Array(N + 1).fill(-1e12);
  const prev = new Int32Array(N + 1).fill(-1);
  dp[0] = 0;

  for (let i = 0; i < N; i++) {
    if (dp[i] < -1e11) continue;
    let charAcc = 0;
    const maxJ = Math.min(N, i + hardMaxW);
    for (let j = i + 1; j <= maxJ; j++) {
      charAcc += (j > i + 1 ? 1 : 0) + run[j - 1].w.length;
      const wCount = j - i;
      const segDur = run[j - 1].e - run[i].s;
      if (strictCeiling && wCount > rawMaxW) break;
      if (wCount > 1 && maxChars > 0 && charAcc > maxChars * 1.45) break;
      if (wCount > 1 && maxDur > 0 && segDur > maxDur * 1.5) break;

      const sVal = dp[i] + scoreBoundaryTransition(run, i, j, prefMin, prefMax, accMin, maxChars, maxDur);
      if (sVal > dp[j]) {
        dp[j] = sVal;
        prev[j] = i;
      }
    }
    if (prev[i + 1] < 0) {
      dp[i + 1] = dp[i] - 50;
      prev[i + 1] = i;
    }
  }

  const cuts = [];
  for (let cur = N; cur > 0; cur = prev[cur]) cuts.push(cur);
  cuts.reverse();

  const out = [];
  let start = 0;
  for (const end of cuts) {
    const part = run.slice(start, end);
    start = end;
    if (!part.length) continue;
    const rs = part[0].s;
    const re = part[part.length - 1].e;
    out.push({
      id: nextId(),
      s: rs,
      e: re,
      rawS: rs,
      rawE: re,
      t: normalizeArabicSubtitlePunctuation(part.map((w) => w.w).join(' ')),
      words: part.map((w) => ({ w: w.w, s: w.s, e: w.e })),
    });
  }
  return out;
}

/**
 * Intelligent Linguistic & Pause Segmentation Engine:
 * - Preferred 8-12 words per segment (flexible 6-14 to preserve phrases/meaning)
 * - Uses Dynamic Programming to align boundaries with sentence structure,
 *   natural pauses, and grammatical integrity across English, Arabic, and Urdu.
 */
export function splitByLimits(words, maxChars = 84, maxWords = 12, maxDur = 8, nextId = () => Date.now() + Math.random()) {
  if (!words?.length) return [];
  return intelligentSemanticSegment(words, { maxChars, maxWords, maxDur, nextId });
}

function cleanWordTimingSlice(ws, s, e, text) {
  const cleaned = (ws || [])
    .filter((w) => w && String(w.w || '').replace(/\|/g, '').trim())
    .map((w) => ({ w: String(w.w).replace(/\|/g, '').trim(), s: Number(w.s) || 0, e: Math.max((Number(w.s) || 0) + 0.02, Number(w.e) || (Number(w.s) || 0) + 0.2) }));
  return cleaned.length ? cleaned : synthWords({ s, e, t: text });
}

function sliceProportionalWords(text, weights, totalW) {
  if (!text) return weights.map(() => '');
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return weights.map(() => '');
  if (weights.length <= 1) return [tokens.join(' ')];
  const out = [];
  let cursor = 0;
  let accW = 0;
  for (let k = 0; k < weights.length; k++) {
    accW += weights[k];
    const targetEnd = k === weights.length - 1 ? tokens.length : Math.max(cursor, Math.min(tokens.length, Math.round((accW / Math.max(1e-6, totalW)) * tokens.length)));
    out.push(tokens.slice(cursor, targetEnd).join(' '));
    cursor = targetEnd;
  }
  return out;
}

export function splitCueByPipe(cue, nextId = () => Date.now() + Math.random()) {
  if (!cue) return [];
  const rawT = String(cue.t || '');
  const rawTr = cue.tr !== undefined ? String(cue.tr) : undefined;
  const hasPipeInT = rawT.includes('|');
  const hasPipeInTr = rawTr !== undefined && rawTr.includes('|');

  if (!hasPipeInT && !hasPipeInTr) return [cue];

  const cleanPart = (p) => p.replace(/[ \t]+/g, ' ').trim();
  const baseParts = hasPipeInT ? rawT.split('|').map(cleanPart).filter(Boolean) : [];
  const trPipeParts = hasPipeInTr ? rawTr.split('|').map(cleanPart).filter(Boolean) : null;

  const count = baseParts.length >= 2 ? baseParts.length : trPipeParts && trPipeParts.length >= 2 ? trPipeParts.length : 1;
  if (count <= 1) {
    return [{
      ...cue,
      t: rawT.replace(/\|/g, ' ').replace(/[ \t]+/g, ' ').trim(),
      ...(rawTr !== undefined ? { tr: rawTr.replace(/\|/g, ' ').replace(/[ \t]+/g, ' ').trim() } : {}),
    }];
  }

  const rs = Number(cue.rawS !== undefined ? cue.rawS : cue.s) || 0;
  const re = Math.max(rs + 0.05 * count, Number(cue.rawE !== undefined ? cue.rawE : cue.e) || rs + 2);
  const segTexts = baseParts.length === count ? baseParts : sliceProportionalWords(rawT.replace(/\|/g, ' '), trPipeParts.map((p) => p.length + 4), trPipeParts.reduce((s, p) => s + p.length + 4, 0));

  const partTokenLists = segTexts.map((txt) => txt.trim().split(/\s+/).filter(Boolean));
  const totalPartTokens = partTokenLists.reduce((sum, arr) => sum + arr.length, 0);

  const weights = partTokenLists.map((toks, idx) => toks.length * 2.2 + segTexts[idx].replace(/\s+/g, '').length * 0.45 + 0.5);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const existingWs = (cue.words || cue.w || [])
    .filter((w) => w && String(w.w || '').replace(/\|/g, '').trim())
    .map((w) => ({ w: String(w.w).replace(/\|/g, '').trim(), s: Number(w.s) || 0, e: Math.max((Number(w.s) || 0) + 0.02, Number(w.e) || (Number(w.s) || 0) + 0.15) }));
  const exactWordMatch = existingWs.length > 0 && existingWs.length === totalPartTokens;

  let origSegs = null;
  if (cue.orig !== undefined) {
    const rawOrig = String(cue.orig);
    if (rawOrig.includes('|')) {
      const op = rawOrig.split('|').map(cleanPart).filter(Boolean);
      origSegs = op.length === count ? op : sliceProportionalWords(rawOrig.replace(/\|/g, ' '), weights, totalWeight);
    } else {
      origSegs = sliceProportionalWords(rawOrig, weights, totalWeight);
    }
  }

  let trSegs = null;
  if (rawTr !== undefined) {
    if (trPipeParts && trPipeParts.length === count) trSegs = trPipeParts;
    else trSegs = sliceProportionalWords(rawTr.replace(/\|/g, ' '), weights, totalWeight);
  }

  const out = [];
  let tokCursor = 0;
  let timeCursor = rs;
  let weightAcc = 0;

  for (let k = 0; k < count; k++) {
    const toks = partTokenLists[k];
    const segText = normalizeArabicSubtitlePunctuation(segTexts[k]);
    let segS;
    let segE;
    let segWords;

    if (exactWordMatch) {
      segWords = existingWs.slice(tokCursor, tokCursor + toks.length);
      tokCursor += toks.length;
      segS = k === 0 ? Math.min(rs, segWords[0]?.s ?? rs) : Math.max(timeCursor, segWords[0]?.s ?? timeCursor);
      segE = k === count - 1 ? Math.max(re, segWords[segWords.length - 1]?.e ?? segS + 0.15) : Math.max(segS + 0.05, segWords[segWords.length - 1]?.e ?? segS + 0.25);
      if (k < count - 1 && existingWs[tokCursor]) {
        const nextWordS = existingWs[tokCursor].s;
        if (nextWordS > segE && nextWordS - segE < 0.12) {
          segE = (segE + nextWordS) * 0.5;
        }
      }
      timeCursor = segE;
    } else {
      segS = timeCursor;
      weightAcc += weights[k];
      segE = k === count - 1 ? re : +(rs + ((re - rs) * weightAcc) / totalWeight).toFixed(3);
      segE = Math.max(segS + 0.08, Math.min(re - 0.08 * (count - 1 - k), segE));
      timeCursor = segE;
      segWords = cleanWordTimingSlice(null, segS, segE, segText);
    }

    const piece = {
      ...cue,
      id: k === 0 && cue.id !== undefined ? cue.id : nextId(),
      s: +segS.toFixed(3),
      e: +segE.toFixed(3),
      rawS: +segS.toFixed(3),
      rawE: +segE.toFixed(3),
      t: segText,
      words: segWords,
      ...(cue.st ? { st: JSON.parse(JSON.stringify(cue.st)) } : {}),
    };
    if (origSegs) piece.orig = origSegs[k];
    if (trSegs) piece.tr = trSegs[k];
    if (k > 0) delete piece.trIssue;
    out.push(piece);
  }

  return out;
}

export function expandAllPipeSubtitles(subs, nextId = () => Date.now() + Math.random()) {
  const out = [];
  for (const cue of subs || []) {
    out.push(...splitCueByPipe(cue, nextId));
  }
  return out;
}

export function segsToSubs(segs, maxChars = 84, maxWords = 12, maxDur = 8, nextId) {
  const rawList = [];
  const hasLimits = maxChars > 0 || maxWords > 0 || maxDur > 0;
  for (const g of segs || []) {
    if (String(g.t || '').includes('|')) {
      const pipeParts = splitCueByPipe({ ...g, words: g.w || g.words }, nextId);
      rawList.push(...pipeParts);
      continue;
    }
    const ws = cleanWordList(g);
    if (!ws.length) {
      const rs = Number(g.s) || 0;
      const re = Number(g.e) || 0;
      if ((g.t || '').trim()) {
        rawList.push({
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
    rawList.push({
      id: nextId(),
      s: Number(g.s) || ws[0].s,
      e: Number(g.e) || ws[ws.length - 1].e,
      rawS: Number(g.s) || ws[0].s,
      rawE: Number(g.e) || ws[ws.length - 1].e,
      t: normalizeArabicSubtitlePunctuation(ws.map((w) => w.w).join(' ')),
      words: ws,
    });
  }

  if (!hasLimits) return rawList;

  // Collect all timed words and apply 3-Pass Intelligent Semantic Segmentation
  const allWords = [];
  const out = [];

  for (const item of rawList) {
    if (!item.words?.length) {
      if (allWords.length) {
        out.push(...intelligentSemanticSegment(allWords, { maxChars, maxWords, maxDur, nextId }));
        allWords.length = 0;
      }
      out.push(item);
      continue;
    }
    allWords.push(...item.words);
  }

  if (allWords.length) {
    out.push(...intelligentSemanticSegment(allWords, { maxChars, maxWords, maxDur, nextId }));
  }

  return autoRepairCues(out, { maxChars, maxWords, maxDur }, nextId);
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
  const maxW = Number(limits.maxWords) || 12;
  const maxD = Number(limits.maxDur) || 8;

  for (const raw of items || []) {
    const cur = { ...raw, t: String(raw.t || '').trim() };
    if (!cur.t) continue;
    if (!out.length) {
      out.push(cur);
      continue;
    }
    const prev = out[out.length - 1];
    const prevWords = prev.t.split(/\s+/).filter(Boolean).length;
    const curWords = cur.t.split(/\s+/).filter(Boolean).length;
    const gap = Math.max(0, (Number(cur.rawS ?? cur.s) || 0) - (Number(prev.rawE ?? prev.e) || 0));
    const comb = (prev.t + ' ' + cur.t).replace(/\s+/g, ' ').trim();
    const words = comb.split(/\s+/);
    const overChars = maxC > 0 && comb.length > maxC;
    const overWords = maxW > 0 && words.length > maxW;
    const overDur = (Number(cur.rawE ?? cur.e) - Number(prev.rawS ?? prev.s)) > maxD;
    // Merge when either side is short (< 6 words) or previous did not end with terminal punctuation
    const needsRepair = prevWords < 6 || curWords < 6 || !ends.test(prev.t);
    if (!needsRepair || (ends.test(prev.t) && gap >= 0.5) || gap >= 1.35 || overChars || overWords || overDur) {
      out.push(cur);
    } else {
      prev.t = comb;
      prev.e = cur.e;
      prev.rawE = cur.rawE ?? cur.e;
      if (prev.words && cur.words) prev.words.push(...cur.words);
    }
  }
  return autoRepairCues(out, limits);
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
  return await webAiCallJson({ prov, url, key, model, temp }, prompt, systemMsg, onNote);
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
    preferences: {
      preferredWordRange: '8-12',
      acceptableWordRange: '6-14',
      maxWords: limits.maxWords || 12,
      maxDuration: limits.maxDur || 8,
    },
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

  try {
    if (onNote) onNote('AI analyzing lecture discourse & semantic clauses…');
    const res = await aiCallJson(
      aiCfg,
      `Split this word sequence into natural, grammatically intact subtitle segments.\n\nINPUT:\n${JSON.stringify(payload)}`,
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
      throw new Error('AI returned invalid boundary indexes; falling back to local semantic engine.');
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
    return autoRepairCues(out, limits);
  } catch (err) {
    if (onNote) onNote('Falling back to local intelligent semantic segmentation…');
    return intelligentSemanticSegment(words, limits);
  }
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
