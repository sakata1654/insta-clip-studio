/**
 * Intelligent Subtitle Segmentation 2.0 Engine
 * 
 * Provides a dedicated 3-Pass Semantic Segmentation pipeline:
 * - Pass 1: Sentence & Discourse Unit Reconstruction (preserves short 6-12w sentences as single cues)
 * - Pass 2: Clause-Aware Dynamic Programming Slicing for long compound sentences (avoids cutting subject-verb, glue words, titles)
 * - Pass 3: Deterministic Post-Segmentation Auto-Repair & Quality Validation (merges orphan fragments, fixes trailing glue words)
 */

import { normalizeArabicSubtitlePunctuation } from '../prompts.js';

// --- Linguistic Rule Sets ---

export const GLUE_TRAILING_WORDS = new Set([
  // English articles, determiners & prepositions
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'our', 'your', 'my', 'its',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
  'of', 'onto', 'upon', 'within', 'without', 'toward', 'towards', 'among', 'across',
  // English conjunctions & connectives
  'and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although', 'since', 'unless', 'while', 'where',
  'if', 'which', 'who', 'whom', 'whose', 'whether', 'as', 'than',
  // Arabic particles, prepositions, conjunctions
  'في', 'من', 'إلى', 'الى', 'على', 'عن', 'مع', 'عند', 'بين', 'حتى', 'لـ', 'بـ', 'كـ',
  'أن', 'إن', 'بان', 'بانها', 'بانه', 'كي', 'لكي', 'و', 'أو', 'او', 'ثم', 'لكن', 'لأن', 'لان', 'بل',
  'الذي', 'التي', 'الذين', 'اللواتي', 'اللاتي', 'إذا', 'اذا', 'لو', 'لما', 'كلما',
  // Urdu postpositions, conjunctions, prefixes
  'نے', 'کو', 'سے', 'میں', 'پر', 'کا', 'کی', 'کے', 'تک', 'لیے', 'لئے', 'والا', 'والی', 'والے',
  'اور', 'یا', 'لیکن', 'مگر', 'کیونکہ', 'کہ', 'جب', 'اگر', 'تاکہ', 'چونکہ', 'بلکہ', 'تو', 'پھر',
]);

export const VERBS_AND_COPULAS = new Set([
  // English copulas, auxiliaries and common predicative verbs
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'has', 'have', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'do', 'does', 'did', 'doing',
  'became', 'becomes', 'become', 'seems', 'seemed', 'remains', 'remained',
  'means', 'meant', 'shows', 'showed', 'proves', 'proved',
  'says', 'said', 'tells', 'told', 'explains', 'explained',
  // Arabic common copular/auxiliary verbs
  'كان', 'كانت', 'يكون', 'تكون', 'أصبح', 'صار', 'ليس', 'ليست', 'قال', 'قالت', 'يقول', 'تقول',
  // Urdu auxiliaries
  'ہے', 'ہیں', 'تھا', 'تھی', 'تھے', 'ہو', 'ہوں', 'ہوتا', 'ہوتی', 'ہوتے', 'ہوا', 'ہوئی', 'ہوئے',
]);

export const HONORIFIC_PREFIXES = new Set([
  'prophet', 'messenger', 'sheikh', 'shaykh', 'imam', 'hazrat', 'maulana', 'mufti', 'dr', 'dr.',
  'brother', 'sister', 'allamah', 'sayyidina', 'sayyiduna', 'ustadh', 'ustadha',
  'نبي', 'رسول', 'شيخ', 'إمام', 'امام', 'سيدنا', 'حضرت', 'مولانا', 'مفتی', 'علامہ',
]);

export const HONORIFIC_SUFFIXES = new Set([
  'ﷺ', '(pbuh)', 'pbuh', '(saw)', '(saww)', '(ra)', '(as)', '(rh)',
  'صلى', 'وسلم', 'تعالى', 'سبحانه', 'عنه', 'عنها', 'عنهم', 'رحمه', 'الله',
  'علیہ', 'السلام', 'رضی', 'رحمتہ',
]);

export const SUBORDINATE_CLAUSE_OPENERS = new Set([
  'because', 'although', 'while', 'whereas', 'since', 'whenever', 'wherever', 'unless',
  'if', 'even', 'provided', 'assuming',
  'لأن', 'لان', 'حيث', 'بينما', 'مع', 'حين', 'طالما',
  'کیونکہ', 'حالانکہ', 'جبکہ', 'چنانچہ',
]);

const normTok = (raw) =>
  String(raw || '')
    .toLowerCase()
    .replace(/^[\s"'“”‘’(\[{«]+|[\s"'“”‘’)\]}.!?؟،,;؛:…۔»]+$/gu, '')
    .trim();

export const isSentenceTerminal = (w) => /[.!?؟۔…।]$/u.test(String(w || '').trim());
export const isClauseTerminal = (w) => /[,،;؛:—–-]$/u.test(String(w || '').trim());

// --- Pass 1: Sentence & Discourse Unit Reconstruction ---

/**
 * Reconstructs continuous speech into grammatical sentences and rhetorical discourse units.
 * Prevents chopping mid-clause on normal breathing or thinking pauses (< 1.25s).
 */
export function reconstructDiscourseSentences(words) {
  if (!words || !words.length) return [];
  const sentences = [];
  let cur = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur.length ? cur[cur.length - 1] : null;
    const gap = prev ? Math.max(0, w.s - prev.e) : 0;
    const prevTerm = prev ? isSentenceTerminal(prev.w) : false;
    const prevNorm = prev ? normTok(prev.w) : '';

    // A true sentence break occurs when:
    // 1. Explicit sentence punctuation was encountered AND the sentence has at least 3 words
    // 2. OR a major silence gap (>= 1.35s) occurred, provided the previous word is NOT an unresolved glue word
    const strongPunctBreak = prevTerm && cur.length >= 3;
    const strongPauseBreak = gap >= 1.35 && cur.length >= 6 && !GLUE_TRAILING_WORDS.has(prevNorm);

    if (cur.length && (strongPunctBreak || strongPauseBreak)) {
      sentences.push(cur);
      cur = [];
    }

    cur.push(w);
  }

  if (cur.length) sentences.push(cur);
  return sentences;
}

// --- Pass 2: Clause-Aware Dynamic Programming Slicing ---

function scoreSplitPoint(words, i, j, prefMin, prefMax, accMin, maxChars, maxDur) {
  const n = j - i;
  const dur = words[j - 1].e - words[i].s;
  const chars = words.slice(i, j).reduce((sum, x) => sum + x.w.length, 0) + Math.max(0, n - 1);
  const gap = j < words.length ? Math.max(0, words[j].s - words[j - 1].e) : 0;
  const rawPrev = words[j - 1].w;
  const rawNext = j < words.length ? words[j].w : '';
  const prev = normTok(rawPrev);
  const next = normTok(rawNext);
  const endPunct = isSentenceTerminal(rawPrev);
  const clausePunct = isClauseTerminal(rawPrev);

  let score = 0;

  // 1. Word Count Distribution (Sweet spot 8-12 words)
  const targetMid = (prefMin + prefMax) * 0.5;
  if (n >= prefMin && n <= prefMax) {
    score += 5.0 - Math.abs(n - targetMid) * 0.2;
  } else if (n >= accMin && n <= prefMax + 2) {
    score += 2.0 - Math.abs(n - targetMid) * 0.25;
  } else if (n < accMin) {
    // Very short cues (< 5 words) are strongly penalized unless they are standalone complete sentences with punctuation
    score -= endPunct ? 3.0 : 12.0 * (accMin - n);
  } else {
    score -= (n - prefMax) * 2.5;
  }

  // 2. Hard Limits Constraints
  if (maxChars > 0 && chars > maxChars) score -= (chars - maxChars) * 0.5;
  if (maxDur > 0 && dur > maxDur) score -= (dur - maxDur) * 2.5;

  // 3. Boundary Quality Evaluation
  if (j < words.length) {
    if (endPunct) {
      score += 10.0;
    } else if (clausePunct) {
      score += 5.5;
    }

    // Natural breathing pause reward
    if (gap >= 0.65) score += 4.5;
    else if (gap >= 0.3) score += 2.5;

    // --- Strict Grammatical Penalties (DO NOT CUT) ---
    if (!endPunct) {
      // Never cut after an article, preposition, or connective glue word
      if (GLUE_TRAILING_WORDS.has(prev)) {
        score -= 28.0;
      }

      // Never cut immediately before a verb/auxiliary/copula separating subject from predicate
      // E.g. "So Islam itself" | "is a complete framework..."
      if (VERBS_AND_COPULAS.has(next)) {
        score -= 26.0;
      }

      // Never cut between auxiliary and main verb
      if (VERBS_AND_COPULAS.has(prev)) {
        score -= 24.0;
      }

      // Never cut before or after honorifics & titles
      if (HONORIFIC_PREFIXES.has(prev) || HONORIFIC_SUFFIXES.has(next) || rawNext.includes('ﷺ')) {
        score -= 32.0;
      }
      if (prev === 'prophet' && /^muhammad/i.test(next)) {
        score -= 30.0;
      }

      // Never separate relative pronouns ('that', 'which', 'who') when phrase is short
      if ((next === 'that' || next === 'which' || next === 'who') && n < 6) {
        score -= 20.0;
      }

      // Reward natural clause starters when the preceding clause has sufficient weight
      if (SUBORDINATE_CLAUSE_OPENERS.has(next) && n >= 6) {
        score += 3.5;
      }
    }
  }

  return score;
}

/**
 * Splits a single long sentence into optimal 8-12 word cues using dynamic programming.
 */
function sliceSentenceWithDP(sentenceWords, maxChars, maxWords, maxDur, nextId) {
  const N = sentenceWords.length;
  if (N === 0) return [];

  const rawMaxW = Number(maxWords) || 12;
  const prefMin = Math.max(6, Math.min(8, rawMaxW - 3));
  const prefMax = Math.max(10, rawMaxW);
  const accMin = Math.max(5, prefMin - 2);
  const hardMaxW = Math.max(prefMax + 2, 14);

  // If the sentence already fits within acceptable bounds, keep it 100% intact!
  if (N <= hardMaxW) {
    const singleChars = sentenceWords.reduce((s, x) => s + x.w.length, 0) + N - 1;
    const singleDur = sentenceWords[N - 1].e - sentenceWords[0].s;
    const fitsMaxC = !maxChars || singleChars <= maxChars * 1.08;
    const fitsMaxW = N <= (rawMaxW <= 9 ? rawMaxW : 14);
    const fitsDur = !maxDur || singleDur <= maxDur * 1.15;
    if (fitsMaxW && fitsMaxC && fitsDur) {
      const rs = sentenceWords[0].s;
      const re = sentenceWords[N - 1].e;
      return [{
        id: nextId(),
        s: rs,
        e: re,
        rawS: rs,
        rawE: re,
        t: normalizeArabicSubtitlePunctuation(sentenceWords.map((w) => w.w).join(' ')),
        words: sentenceWords.map((w) => ({ w: w.w, s: w.s, e: w.e })),
      }];
    }
  }

  const dp = new Float64Array(N + 1).fill(-1e12);
  const backpointer = new Int32Array(N + 1).fill(-1);
  dp[0] = 0;

  for (let i = 0; i < N; i++) {
    if (dp[i] < -1e11) continue;
    let charAcc = 0;
    const maxJ = Math.min(N, i + hardMaxW);
    for (let j = i + 1; j <= maxJ; j++) {
      charAcc += (j > i + 1 ? 1 : 0) + sentenceWords[j - 1].w.length;
      const wCount = j - i;
      const segDur = sentenceWords[j - 1].e - sentenceWords[i].s;

      if (wCount > 1 && maxChars > 0 && charAcc > maxChars * 1.4) break;
      if (wCount > 1 && maxDur > 0 && segDur > maxDur * 1.5) break;

      const sVal = dp[i] + scoreSplitPoint(sentenceWords, i, j, prefMin, prefMax, accMin, maxChars, maxDur);
      if (sVal > dp[j]) {
        dp[j] = sVal;
        backpointer[j] = i;
      }
    }

    if (backpointer[i + 1] < 0) {
      dp[i + 1] = dp[i] - 60;
      backpointer[i + 1] = i;
    }
  }

  const cuts = [];
  for (let cur = N; cur > 0; cur = backpointer[cur]) cuts.push(cur);
  cuts.reverse();

  const cues = [];
  let start = 0;
  for (const end of cuts) {
    const part = sentenceWords.slice(start, end);
    start = end;
    if (!part.length) continue;
    const rs = part[0].s;
    const re = part[part.length - 1].e;
    cues.push({
      id: nextId(),
      s: rs,
      e: re,
      rawS: rs,
      rawE: re,
      t: normalizeArabicSubtitlePunctuation(part.map((w) => w.w).join(' ')),
      words: part.map((w) => ({ w: w.w, s: w.s, e: w.e })),
    });
  }

  return cues;
}

// --- Pass 3: Post-Segmentation Auto-Repair & Quality Validation ---

/**
 * Inspects segmented cues and fixes:
 * 1. Orphan short fragments (< 5 words without terminal punctuation) -> merged with neighbor.
 * 2. Trailing glue words (articles, prepositions, conjunctions) -> shifted or merged.
 * 3. Dangling subordinate clauses (e.g. "that they accepted Islam.") -> merged with main clause.
 */
export function autoRepairCues(cues, limits = {}, nextId = () => Date.now() + Math.random()) {
  if (!cues || cues.length <= 1) return cues || [];
  const maxW = limits.maxWords || 14;
  const maxC = limits.maxChars || 88;
  const maxD = limits.maxDur || 8.5;

  let list = cues.map((c) => ({
    ...c,
    t: String(c.t || '').trim(),
    words: c.words ? [...c.words] : [],
  }));

  let changed = true;
  let iterations = 0;

  while (changed && iterations < 3) {
    changed = false;
    iterations++;
    const out = [];

    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      if (!out.length) {
        out.push(cur);
        continue;
      }

      const prev = out[out.length - 1];
      const prevTokens = prev.t.split(/\s+/).filter(Boolean);
      const curTokens = cur.t.split(/\s+/).filter(Boolean);
      const prevLast = prevTokens.length ? normTok(prevTokens[prevTokens.length - 1]) : '';
      const curFirst = curTokens.length ? normTok(curTokens[0]) : '';
      const prevEndsPunct = isSentenceTerminal(prev.t);
      const combinedWords = prevTokens.length + curTokens.length;
      const combinedText = (prev.t + ' ' + cur.t).replace(/\s+/g, ' ').trim();
      const combinedDur = Math.max(0, (Number(cur.rawE ?? cur.e) || 0) - (Number(prev.rawS ?? prev.s) || 0));
      const gap = Math.max(0, (Number(cur.rawS ?? cur.s) || 0) - (Number(prev.rawE ?? prev.e) || 0));

      const fitsCombined = combinedWords <= Math.max(maxW, 14) &&
        (!maxC || combinedText.length <= maxC) &&
        (!maxD || combinedDur <= maxD);

      // Rule A: Orphan short fragment (< 5 words without terminal punctuation)
      const prevIsShortOrphan = prevTokens.length < 5 && !prevEndsPunct;
      const curIsShortOrphan = curTokens.length < 5 && !isSentenceTerminal(cur.t);

      // Rule B: Trailing glue word at the end of previous cue
      const prevEndsInGlue = GLUE_TRAILING_WORDS.has(prevLast) && !prevEndsPunct;

      // Rule C: Dangling subordinate opener at the beginning of current cue
      // E.g. "that they accepted Islam."
      const curStartsWithSubordinate = (curFirst === 'that' || curFirst === 'which' || curFirst === 'who') && !prevEndsPunct;

      // Rule D: Previous ended on verb/copula and current begins with predicate
      const prevEndsOnVerb = VERBS_AND_COPULAS.has(prevLast) && !prevEndsPunct;

      if ((prevIsShortOrphan || curIsShortOrphan || prevEndsInGlue || curStartsWithSubordinate || prevEndsOnVerb) && fitsCombined && gap < 1.3) {
        // Merge seamlessly
        prev.t = combinedText;
        prev.e = cur.e;
        prev.rawE = cur.rawE ?? cur.e;
        if (prev.words && cur.words) {
          prev.words = [...prev.words, ...cur.words];
        }
        changed = true;
      } else if (prevEndsInGlue && prevTokens.length > 5 && !prevEndsPunct && curTokens.length < maxW) {
        // Shift the trailing glue word to the beginning of cur
        const shiftedWord = prev.words ? prev.words.pop() : null;
        prevTokens.pop();
        prev.t = prevTokens.join(' ');
        if (shiftedWord && cur.words) {
          cur.words.unshift(shiftedWord);
        }
        cur.t = (shiftedWord ? shiftedWord.w : prevLast) + ' ' + cur.t;
        if (prev.words && prev.words.length) {
          prev.e = prev.words[prev.words.length - 1].e;
          prev.rawE = prev.e;
        }
        if (cur.words && cur.words.length) {
          cur.s = cur.words[0].s;
          cur.rawS = cur.s;
        }
        out.push(cur);
        changed = true;
      } else {
        out.push(cur);
      }
    }

    list = out;
  }

  return list;
}

// --- Main Engine Entry Point ---

/**
 * Intelligent Semantic Subtitle Segmentation 2.0
 * 
 * Takes timed words and produces balanced, natural, grammatically complete subtitle cues.
 * 
 * @param {Array<{w: string, s: number, e: number}>} words
 * @param {Object} options { maxChars, maxWords, maxDur, nextId }
 * @returns {Array<Object>} subtitle cues
 */
export function intelligentSemanticSegment(words, options = {}) {
  if (!words || !words.length) return [];

  const maxChars = Number(options.maxChars) || 84;
  const maxWords = Number(options.maxWords) || 12;
  const maxDur = Number(options.maxDur) || 8;
  const nextId = options.nextId || (() => Date.now() + Math.random());

  // Pass 1: Reconstruct grammatical sentences and discourse thought units
  const sentences = reconstructDiscourseSentences(words);

  // Pass 2: Slicing - preserve natural sentences <= maxWords; DP slice only long compound sentences
  const rawCues = [];
  for (const sentence of sentences) {
    if (!sentence.length) continue;
    const cues = sliceSentenceWithDP(sentence, maxChars, maxWords, maxDur, nextId);
    rawCues.push(...cues);
  }

  // Pass 3: Deterministic Auto-Repair & Quality Validation
  const polishedCues = autoRepairCues(rawCues, { maxChars, maxWords, maxDur }, nextId);

  return polishedCues;
}
