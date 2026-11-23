/**
 * Stage 4: The Multi-Engine Panel of Judges & Voting Engine
 * Based on PIPELINE_GUIDE.md T4, Appendix A3, A4, A5
 *
 * Implements:
 * 1. Language-Aware Normalization (Arabic, Urdu, English)
 * 2. Whole-transcript sequence-matcher word alignment (aligns by words, NEVER by time)
 * 3. Soft Majority Vote (voteTextSoft): 75% spelling similarity requirement, 2-against-1 rule
 * 4. Do-No-Harm Gate: Verify that any proposed judge output never invents words (>= 95% word containment, <= 1.3x length)
 */

export const AGREE_THRESHOLD = 0.88;
export const SOFT_VOTE_THRESHOLD = 0.75;
export const SAME_MEANING_THRESHOLD = 0.90;

/**
 * Normalizes Arabic script strictly for comparison (never for output).
 * Strips harakat, tatweel, maps hamzas, alif maqsura, ta marbuta.
 */
export function normArabic(text) {
  if (!text) return '';
  return String(text)
    // Strip Arabic diacritics (tashkeel) and tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    // Normalize alef variants to bare alef
    .replace(/[أإآٱ]/gu, 'ا')
    // Normalize alif maqsura to ya
    .replace(/ى/gu, 'ي')
    // Normalize ta marbuta to ha
    .replace(/ة/gu, 'ه')
    // Strip punctuation and symbols
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»؛،؟…–—]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalizes Urdu script strictly for comparison.
 * Maps Urdu-specific variants to standard base letters for comparison.
 */
export function normUrdu(text) {
  if (!text) return '';
  return normArabic(text)
    // Bari ye to choti ye
    .replace(/ے/gu, 'ی')
    // Choti he / do-chashmi he
    .replace(/ھ/gu, 'ہ')
    // Noon ghunna to noon
    .replace(/ں/gu, 'ن');
}

/**
 * Normalizes English/Latin text strictly for comparison.
 */
export function normLatin(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»…–—]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes words according to detected language.
 */
export function normWord(word, lang = 'auto') {
  const isUrdu = lang === 'ur' || /[\u0679\u0686\u0688\u0698\u0691\u06D2\u06BA]/.test(word);
  if (isUrdu) return normUrdu(word);
  const isArabic = /[\u0600-\u06FF]/.test(word);
  if (isArabic) return normArabic(word);
  return normLatin(word);
}

/**
 * Computes character-level similarity ratio between two strings (0.0 to 1.0)
 * Equivalent to Python's difflib.SequenceMatcher(None, a, b).ratio()
 */
export function similarityRatio(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0.0;

  // Compute Longest Common Subsequence length
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i * (m + 1) + j] = dp[(i - 1) * (m + 1) + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * (m + 1) + j];
        const left = dp[i * (m + 1) + (j - 1)];
        dp[i * (m + 1) + j] = up > left ? up : left;
      }
    }
  }
  const matches = dp[n * (m + 1) + m];
  return (2.0 * matches) / (n + m);
}

/**
 * Computes diff opcodes between two arrays of normalized tokens.
 * Produces opcodes: ['equal' | 'replace' | 'delete' | 'insert', i1, i2, j1, j2]
 */
export function computeOpCodes(aTokens, bTokens) {
  const n = aTokens.length;
  const m = bTokens.length;
  const dp = new Int32Array((n + 1) * (m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aTokens[i - 1] === bTokens[j - 1]) {
        dp[i * (m + 1) + j] = dp[(i - 1) * (m + 1) + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * (m + 1) + j];
        const left = dp[i * (m + 1) + (j - 1)];
        dp[i * (m + 1) + j] = up > left ? up : left;
      }
    }
  }

  // Backtrack to find alignment operations
  let i = n;
  let j = m;
  const rawOps = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aTokens[i - 1] === bTokens[j - 1]) {
      rawOps.push(['equal', i - 1, i, j - 1, j]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * (m + 1) + (j - 1)] >= dp[(i - 1) * (m + 1) + j])) {
      rawOps.push(['insert', i, i, j - 1, j]);
      j--;
    } else if (i > 0 && (j === 0 || dp[i * (m + 1) + (j - 1)] < dp[(i - 1) * (m + 1) + j])) {
      rawOps.push(['delete', i - 1, i, j, j]);
      i--;
    }
  }
  rawOps.reverse();

  // Merge adjacent non-equal blocks into unified replace/insert/delete opcodes
  const merged = [];
  for (const op of rawOps) {
    if (!merged.length) {
      merged.push(op);
      continue;
    }
    const last = merged[merged.length - 1];
    if (last[0] === op[0] && last[0] === 'equal') {
      last[2] = op[2];
      last[4] = op[4];
    } else if (last[0] !== 'equal' && op[0] !== 'equal') {
      last[0] = 'replace';
      last[2] = op[2];
      last[4] = op[4];
    } else {
      merged.push(op);
    }
  }
  return merged;
}

/**
 * Aligns two transcripts by words (NEVER by time) across the entire transcript.
 * For each segment of the `main` transcript, finds the words of `other` that say the same thing.
 * 
 * @param {Array<{ text: string, s?: number, e?: number }>} mainSegments
 * @param {Array<{ text: string, s?: number, e?: number }>} otherSegments
 * @param {string} lang
 * @returns {Array<string>} Text of other corresponding to each main segment
 */
export function alignTranscriptsByWords(mainSegments, otherSegments, lang = 'ar') {
  const mw = [];
  const bounds = [];
  for (const s of mainSegments) {
    const ws = (s.text || s.t || '').trim().split(/\s+/).filter(Boolean);
    bounds.push([mw.length, mw.length + ws.length]);
    mw.push(...ws);
  }

  const ow = [];
  for (const s of otherSegments) {
    const ws = (s.text || s.t || '').trim().split(/\s+/).filter(Boolean);
    ow.push(...ws);
  }

  const mk = mw.map((w) => normWord(w, lang));
  const ok = ow.map((w) => normWord(w, lang));

  const ops = computeOpCodes(mk, ok);

  function mapIdx(i) {
    if (i >= mk.length) return ow.length;
    for (const [tag, i1, i2, j1, j2] of ops) {
      if (i >= i1 && i < i2) {
        if (tag === 'equal') return j1 + (i - i1);
        const spanI = Math.max(1, i2 - i1);
        const spanJ = j2 - j1;
        return j1 + Math.round(((i - i1) / spanI) * spanJ);
      }
    }
    return ow.length;
  }

  return bounds.map(([a, b]) => {
    const startJ = mapIdx(a);
    const endJ = mapIdx(b);
    return ow.slice(startJ, endJ).join(' ');
  });
}

/**
 * Soft Word-Level Majority Vote (Appendix A4 vote_text_soft)
 * 
 * texts[0] = the main/pivot engine.
 * A change is made ONLY when BOTH other engines change the same span,
 * and their replacements are spelled >= 75% alike.
 * 
 * @param {Array<string>} texts Array of [pivotText, engine2Text, engine3Text]
 * @param {string} lang
 * @returns {{ text: string, changesCount: number }}
 */
export function voteTextSoft(texts, lang = 'ar') {
  if (!texts || !texts.length) return { text: '', changesCount: 0 };
  if (texts.length === 1) return { text: texts[0], changesCount: 0 };

  const pivot = texts[0].trim().split(/\s+/).filter(Boolean);
  const pn = pivot.map((w) => normWord(w, lang));

  const perEngine = [];
  for (let tIdx = 1; tIdx < texts.length; tIdx++) {
    const o = texts[tIdx].trim().split(/\s+/).filter(Boolean);
    const on = o.map((w) => normWord(w, lang));
    const d = new Map();
    const ops = computeOpCodes(pn, on);
    for (const [tag, i1, i2, j1, j2] of ops) {
      if (tag !== 'equal') {
        const replacementStr = on.slice(j1, j2).join('');
        const replacementWords = o.slice(j1, j2);
        d.set(`${i1},${i2}`, { str: replacementStr, words: replacementWords, i1, i2 });
      }
    }
    perEngine.push(d);
  }

  // Collect all spans proposed for change
  const allSpans = new Set();
  for (const d of perEngine) {
    for (const k of d.keys()) allSpans.add(k);
  }

  const chosen = [];
  for (const spanKey of Array.from(allSpans).sort()) {
    const [i1Str, i2Str] = spanKey.split(',');
    const i1 = Number(i1Str);
    const i2 = Number(i2Str);
    const have = [];
    for (const d of perEngine) {
      if (d.has(spanKey)) have.push(d.get(spanKey));
    }

    // A change needs BOTH other engines to agree on the same span with >= 75% similarity
    if (have.length >= 2 && similarityRatio(have[0].str, have[1].str) >= SOFT_VOTE_THRESHOLD) {
      const ref = pn.slice(i1, i2).join('');
      // Pick the replacement closest to the pivot's own word: the smallest change the majority supports
      let best = have[0].words;
      let bestSim = similarityRatio(have[0].str, ref);
      for (let h = 1; h < have.length; h++) {
        const sim = similarityRatio(have[h].str, ref);
        if (sim > bestSim) {
          bestSim = sim;
          best = have[h].words;
        }
      }
      chosen.push({ i1, i2, words: best });
    }
  }

  // Apply chosen changes non-overlapping
  const out = [];
  let pos = 0;
  let edge = 0;
  let changesCount = 0;

  for (const { i1, i2, words } of chosen) {
    if (i1 < edge) continue;
    out.push(...pivot.slice(pos, i1));
    out.push(...words);
    pos = i2;
    edge = Math.max(edge, i2);
    changesCount++;
  }
  out.push(...pivot.slice(pos));

  return {
    text: out.join(' '),
    changesCount,
  };
}

/**
 * Do-No-Harm Gate (Appendix A5 pick)
 * Verifies that a judge or LLM output does NOT fabricate words.
 * Requires >= 95% of normalized words to exist in the candidate word pool,
 * and length <= 1.3x the longest candidate.
 * 
 * @param {string} proposedText
 * @param {Array<string>} candidates
 * @param {string} lang
 * @returns {{ accepted: boolean, text: string, reason: string }}
 */
export function verifyDoNoHarmGate(proposedText, candidates, lang = 'ar') {
  if (!proposedText || !proposedText.trim()) {
    return { accepted: false, text: candidates[0], reason: 'Empty proposed text' };
  }

  const pool = new Set();
  let maxCandLen = 0;
  for (const c of candidates) {
    const ws = normWord(c, lang).split(/\s+/).filter(Boolean);
    if (ws.length > maxCandLen) maxCandLen = ws.length;
    for (const w of ws) pool.add(w);
  }

  const proposedTokens = normWord(proposedText, lang).split(/\s+/).filter(Boolean);
  if (!proposedTokens.length) {
    return { accepted: false, text: candidates[0], reason: 'No tokens in proposed text' };
  }

  // 1. Length check: cannot exceed 1.3x longest candidate
  if (proposedTokens.length > Math.max(4, Math.round(maxCandLen * 1.3))) {
    return {
      accepted: false,
      text: candidates[0],
      reason: `Length expansion violation: ${proposedTokens.length} > ${Math.round(maxCandLen * 1.3)}`,
    };
  }

  // 2. Vocabulary containment check: >= 95% of words must be in candidate pool
  let inPoolCount = 0;
  for (const t of proposedTokens) {
    if (pool.has(t)) inPoolCount++;
  }
  const containmentRatio = inPoolCount / proposedTokens.length;

  if (containmentRatio < 0.95) {
    return {
      accepted: false,
      text: candidates[0],
      reason: `Vocabulary hallucination violation: containment ${(containmentRatio * 100).toFixed(1)}% < 95%`,
    };
  }

  return { accepted: true, text: proposedText.trim(), reason: 'Passed Do-No-Harm gate' };
}

/**
 * Evaluates candidates for a single segment across the panel.
 * 
 * @param {Array<string>} candidates [cohere/pivot, whisper, qwen/elevenlabs]
 * @param {Function} [llmJudgeFn] Optional async callback for 3-way disagreements
 * @param {string} lang
 * @returns {Promise<{ text: string, status: 'agree' | 'voted' | 'judge' | 'fallback', flag: boolean }>}
 */
export async function evaluatePanelSegment(candidates, llmJudgeFn = null, lang = 'ar') {
  if (!candidates || !candidates.length) return { text: '', status: 'fallback', flag: false };
  if (candidates.length === 1) return { text: candidates[0], status: 'agree', flag: false };

  const normCands = candidates.map((c) => normWord(c, lang));
  const pairSims = [];
  for (let i = 0; i < normCands.length; i++) {
    for (let j = i + 1; j < normCands.length; j++) {
      pairSims.push(similarityRatio(normCands[i], normCands[j]));
    }
  }

  const minPair = Math.min(...pairSims);
  const maxPair = Math.max(...pairSims);

  // 1. High agreement: all engines agree
  if (minPair >= AGREE_THRESHOLD) {
    return { text: candidates[0], status: 'agree', flag: false };
  }

  // 2. Soft majority vote
  const voted = voteTextSoft(candidates, lang);
  if (voted.changesCount > 0 || maxPair >= AGREE_THRESHOLD) {
    return { text: voted.text, status: 'voted', flag: false };
  }

  // 3. Three-way disagreement: call judge with Do-No-Harm gate
  if (llmJudgeFn) {
    try {
      const judgeProposal = await llmJudgeFn(candidates);
      const gate = verifyDoNoHarmGate(judgeProposal, candidates, lang);
      if (gate.accepted) {
        return { text: gate.text, status: 'judge', flag: true };
      }
    } catch {}
  }

  // Keep pivot text, flag for human review
  return { text: candidates[0], status: 'fallback', flag: true };
}
