/**
 * Stage 10 / Review System: Transcription Disagreements, Qur'an Flags, Check Items & Non-Destructive Retiming
 * Based on PIPELINE_GUIDE.md Section 5 (R1-R7)
 *
 * Implements:
 * 1. R1: Compare-engines flags (transcription disagreements between Cohere, Whisper, Qwen/fallback)
 * 2. R1b: Qur'an flags (read-only verification card data with Hilali-Khan translation)
 * 3. R1c: Mechanical check items (lowercase starts, missing full stops, abnormal lengths, style violations, uncovered speech)
 * 4. R4: Non-destructive timing tools (setTimes with clamp, splitCue, mergeCues, nudgeCue)
 */

import { scanTranslationStyleViolations } from './translationEngine.js';

/**
 * Calculates strict word similarity between two word strings (0.0 to 1.0).
 * Word cost: same = 0, slight spelling diff = 0.4, different = 1.0.
 * Similarity = 1 - (total_cost / max(lenA, lenB))
 */
export function calculateEngineWordSimilarity(wordsA, wordsB) {
  const listA = Array.isArray(wordsA) ? wordsA : String(wordsA || '').trim().split(/\s+/).filter(Boolean);
  const listB = Array.isArray(wordsB) ? wordsB : String(wordsB || '').trim().split(/\s+/).filter(Boolean);

  if (!listA.length && !listB.length) return 1.0;
  if (!listA.length || !listB.length) return 0.0;

  let matches = 0;
  let partials = 0;
  const maxLen = Math.max(listA.length, listB.length);

  const setB = new Set(listB.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));

  for (const wA of listA) {
    const cleanA = wA.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (setB.has(cleanA)) {
      matches++;
    } else {
      // Check partial/spelling difference
      let foundPartial = false;
      for (const wB of setB) {
        if (cleanA.length > 3 && wB.length > 3 && (cleanA.includes(wB) || wB.includes(cleanA))) {
          foundPartial = true;
          break;
        }
      }
      if (foundPartial) partials++;
    }
  }

  const score = (matches * 1.0 + partials * 0.6) / maxLen;
  return Math.max(0.0, Math.min(1.0, score));
}

/**
 * R1: Compare-engines flags generation.
 * Compares primary engine (Cohere or ensemble) with Whisper and Qwen/alts for every subtitle.
 *
 * @param {Array<any>} cues Subtitle cues
 * @param {Object} engineTranscripts { cohere: Array<word>, whisper: Array<word>, qwen: Array<word> }
 * @param {Array<number>} blockEdges Timestamps where chunk boundaries occurred
 * @returns {Array<Object>} List of flags
 */
export function generateCompareFlags(cues, engineTranscripts = {}, blockEdges = []) {
  if (!cues || !cues.length) return [];
  const flags = [];

  const { cohere = [], whisper = [], qwen = [] } = engineTranscripts;

  // Helper to extract words in time window [s - 0.2, e + 0.2]
  function getWordsInWindow(wordList, start, end) {
    if (!wordList || !wordList.length) return [];
    return wordList.filter((w) => {
      const s = typeof w.start === 'number' ? w.start : w.s;
      const e = typeof w.end === 'number' ? w.end : w.e;
      if (s === undefined && e === undefined) return false;
      return (s !== undefined ? s : e) >= start - 0.3 && (e !== undefined ? e : s) <= end + 0.3;
    });
  }

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];

    // Qur'an verses are handled in R1b Qur'an flags
    if (cue.isQuran) continue;

    const cueWords = (cue.ar || cue.text || '').trim().split(/\s+/).filter(Boolean);
    const cohereWords = getWordsInWindow(cohere, cue.s, cue.e).map((w) => w.word || w.w || w.text || '');
    const whisperWords = getWordsInWindow(whisper, cue.s, cue.e).map((w) => w.word || w.w || w.text || '');
    const qwenWords = getWordsInWindow(qwen, cue.s, cue.e).map((w) => w.word || w.w || w.text || '');

    // Default to cueWords if an engine has no specific timestamps
    const cWords = cohereWords.length ? cohereWords : cueWords;
    const wWords = whisperWords.length ? whisperWords : cueWords;
    const qWords = qwenWords.length ? qwenWords : cueWords;

    const sw = calculateEngineWordSimilarity(cWords, wWords);
    const sq = calculateEngineWordSimilarity(cWords, qWords);
    const wq = calculateEngineWordSimilarity(wWords, qWords);

    // Check if cue is within 4s of a block edge
    const nearEdge = blockEdges.some((edge) => Math.abs(cue.s - edge) <= 4.0 || Math.abs(cue.e - edge) <= 4.0);

    let flag = false;
    let reason = '';
    let suggestedEngine = null;

    if (sw >= 0.9 || (sq >= 0.9 && !nearEdge)) {
      // Agreement, no flag
      flag = false;
    } else if (sw < 0.8 && sq < 0.8) {
      flag = true;
      reason = 'All three engines heard different words';
    } else if (Math.min(sw, sq) < 0.6) {
      flag = true;
      reason = 'One engine heard something significantly different';
    } else if (nearEdge && sw < 0.8 && cWords.length >= wWords.length + 3) {
      flag = true;
      reason = 'Cohere has words Whisper does not near a chunk boundary';
      suggestedEngine = 'whisper';
    } else if (wq >= 0.9 && sw < 0.85) {
      flag = true;
      reason = 'Whisper and Qwen agree on words that Cohere heard differently';
      suggestedEngine = 'whisper';
    }

    if (flag) {
      flags.push({
        cueId: cue.id || i,
        index: i,
        start: cue.s,
        end: cue.e,
        reason,
        sw: Number(sw.toFixed(2)),
        sq: Number(sq.toFixed(2)),
        wq: Number(wq.toFixed(2)),
        nearEdge,
        suggestedEngine,
        versions: {
          primary: cWords.join(' '),
          whisper: wWords.join(' '),
          qwen: qWords.join(' '),
        },
        resolved: false,
      });
    }
  }

  return flags;
}

/**
 * R1b: Qur'an flags (read-only verification card data).
 */
export function generateQuranFlags(cues, quranMatches = []) {
  const flags = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.isQuran || cue.quranRef) {
      flags.push({
        cueId: cue.id || i,
        index: i,
        start: cue.s,
        end: cue.e,
        surah: cue.quranRef?.surah,
        ayah: cue.quranRef?.ayah,
        uthmani: cue.ar || cue.text,
        hilaliKhan: cue.en || cue.translation,
        similarity: cue.quranRef?.score || 1.0,
        reviewed: false,
      });
    }
  }
  return flags;
}

/**
 * R1c: Mechanical check items.
 * Checks for lowercase starts, missing periods, abnormal durations, quotation issues, and style violations.
 */
export function generateCheckItems(cues, audioSpeechIntervals = []) {
  if (!cues || !cues.length) return [];
  const checks = [];

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const prev = i > 0 ? cues[i - 1] : null;
    const next = i < cues.length - 1 ? cues[i + 1] : null;
    const dur = c.e - c.s;
    const en = String(c.en || '').trim();
    const words = en.split(/\s+/).filter(Boolean);

    // 1. Lowercase sentence start
    if (en && /^[a-z]/.test(en)) {
      const prevEndsSentence = !prev || /[.?!]$/.test(String(prev.en || '').trim());
      if (prevEndsSentence) {
        checks.push({
          cueId: c.id || i,
          index: i,
          type: 'lowercase_start',
          message: `Subtitle starts with lowercase letter: "${en.slice(0, 15)}..."`,
        });
      }
    }

    // 2. Missing full stop at apparent sentence ending
    if (en && !/[.?!,;—–]$/.test(en)) {
      const nextStartsNewSentence = !next || /^[A-Z]/.test(String(next.en || '').trim());
      const longGap = next ? (next.s - c.e > 1.2) : true;
      if (nextStartsNewSentence && longGap) {
        checks.push({
          cueId: c.id || i,
          index: i,
          type: 'missing_period',
          message: `Sentence likely ends here but lacks punctuation.`,
        });
      }
    }

    // 3. Duration extremes
    if (dur < 1.4 && words.length > 5) {
      checks.push({
        cueId: c.id || i,
        index: i,
        type: 'too_fast',
        message: `Too fast to read: ${words.length} words in ${dur.toFixed(1)}s (${(words.length / dur).toFixed(1)} WPS).`,
      });
    } else if (dur > 14.0) {
      checks.push({
        cueId: c.id || i,
        index: i,
        type: 'too_long',
        message: `Subtitle duration exceeds 14s limit (${dur.toFixed(1)}s).`,
      });
    }

    // 4. Quotation mark left open
    const openQuotes = (en.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) {
      checks.push({
        cueId: c.id || i,
        index: i,
        type: 'unbalanced_quotes',
        message: 'Unbalanced quotation marks in subtitle.',
      });
    }
  }

  // 5. Style violations (from translation engine L3)
  const styleViolations = scanTranslationStyleViolations(cues);
  checks.push(...styleViolations);

  // 6. Speech with no subtitle: check if active speech in audio interval has no overlapping cue
  if (audioSpeechIntervals && audioSpeechIntervals.length) {
    for (const interval of audioSpeechIntervals) {
      const intDur = interval.e - interval.s;
      if (intDur < 1.5) continue; // Only flag substantial speech stretches
      const hasCoverage = cues.some((c) => Math.max(c.s, interval.s) < Math.min(c.e, interval.e));
      if (!hasCoverage) {
        checks.push({
          cueId: null,
          index: -1,
          type: 'uncovered_speech',
          message: `Audible speech detected with no subtitle from ${interval.s.toFixed(1)}s to ${interval.e.toFixed(1)}s.`,
          start: interval.s,
          end: interval.e,
        });
      }
    }
  }

  return checks;
}

/**
 * R4: Non-destructive timing tools.
 */

/**
 * Set times with safety clamping and neighbor edge adjustments.
 * Enforces min duration >= 0.2s.
 */
export function setCueTimes(cues, index, newStart, newEnd) {
  if (!cues || index < 0 || index >= cues.length) return cues;
  const updated = [...cues];
  const target = { ...updated[index] };

  let s = Math.max(0, Number(newStart));
  let e = Math.max(s + 0.2, Number(newEnd));

  target.s = Number(s.toFixed(2));
  target.e = Number(e.toFixed(2));
  updated[index] = target;

  // Trim previous neighbor if overlap
  if (index > 0 && updated[index - 1].e > target.s) {
    updated[index - 1] = {
      ...updated[index - 1],
      e: Math.max(updated[index - 1].s + 0.2, target.s),
    };
  }

  // Trim next neighbor if overlap
  if (index < updated.length - 1 && updated[index + 1].s < target.e) {
    updated[index + 1] = {
      ...updated[index + 1],
      s: Math.max(target.e, updated[index + 1].e - 0.2),
    };
  }

  return updated;
}

/**
 * Splits a cue into two cues at a given time or word index.
 */
export function splitCue(cues, index, splitTime) {
  if (!cues || index < 0 || index >= cues.length) return cues;
  const c = cues[index];
  if (splitTime <= c.s + 0.3 || splitTime >= c.e - 0.3) return cues;

  const words = (c.ar || c.text || '').trim().split(/\s+/).filter(Boolean);
  const ratio = (splitTime - c.s) / (c.e - c.s);
  const splitWordIdx = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));

  const part1Ar = words.slice(0, splitWordIdx).join(' ');
  const part2Ar = words.slice(splitWordIdx).join(' ');

  // English split proportionally
  const enWords = (c.en || c.translation || '').trim().split(/\s+/).filter(Boolean);
  const enSplitIdx = Math.max(1, Math.min(enWords.length - 1, Math.round(enWords.length * ratio)));
  const part1En = enWords.slice(0, enSplitIdx).join(' ');
  const part2En = enWords.slice(enSplitIdx).join(' ');

  const cueA = {
    ...c,
    id: `${c.id || index}_a`,
    e: Number(splitTime.toFixed(2)),
    ar: part1Ar,
    text: part1Ar,
    en: part1En,
    translation: part1En,
  };

  const cueB = {
    ...c,
    id: `${c.id || index}_b`,
    s: Number(splitTime.toFixed(2)),
    ar: part2Ar,
    text: part2Ar,
    en: part2En,
    translation: part2En,
  };

  const nextCues = [...cues];
  nextCues.splice(index, 1, cueA, cueB);
  return nextCues;
}

/**
 * Merges two adjacent cues.
 */
export function mergeCues(cues, indexA, indexB) {
  if (!cues || indexA < 0 || indexB >= cues.length || indexA >= indexB) return cues;
  const cA = cues[indexA];
  const cB = cues[indexB];

  const merged = {
    ...cA,
    e: cB.e,
    ar: `${cA.ar || cA.text || ''} ${cB.ar || cB.text || ''}`.trim(),
    text: `${cA.text || cA.ar || ''} ${cB.text || cB.ar || ''}`.trim(),
    en: `${cA.en || cA.translation || ''} ${cB.en || cB.translation || ''}`.trim(),
    translation: `${cA.translation || cA.en || ''} ${cB.translation || cB.en || ''}`.trim(),
  };

  const nextCues = [...cues];
  nextCues.splice(indexA, 2, merged);
  return nextCues;
}

/**
 * Nudges a cue by deltaSeconds.
 */
export function nudgeCue(cues, index, deltaSeconds) {
  if (!cues || index < 0 || index >= cues.length) return cues;
  const c = cues[index];
  const dur = c.e - c.s;
  let newStart = Math.max(0, c.s + deltaSeconds);
  let newEnd = newStart + dur;

  return setCueTimes(cues, index, newStart, newEnd);
}
