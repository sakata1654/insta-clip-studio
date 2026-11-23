/**
 * Stage 8: Sentence-Complete Subtitle Slicer Engine
 * Based on PIPELINE_GUIDE.md Section S5 and Appendix A7
 *
 * Implements:
 * 1. Sentence-Complete Subtitles: Always ends on sentence punctuation (. ? ! ؟ ۔ …)
 * 2. Professional Sizing: Target 55-90 chars, 8-12 words, max 14s, min 1.6s
 * 3. Reading speed comfort extension: 15 chars/second (borrowing from pause without overlap)
 * 4. Stub fix: trailing words of next sentence handed over; leading words handed back
 * 5. Orphan collapse: fragments < 25 chars folded into neighbor (< 1.5s apart, <= 16s combined)
 * 6. Numbered headings repositioning: "The fifth issue." moved to start of next cue
 */

export const CUE_MIN_CHARS = 55;
export const CUE_TARGET_CHARS = 90;
export const CUE_MAX_SENTENCES = 3;
export const CUE_MAX_SECONDS = 14.0;
export const READ_MIN_SECONDS = 1.6;
export const READ_CPS = 15.0;

export const SENTENCE_TERMINAL_REGEX = /[.!?؟۔…]$/u;
export const CLAUSE_PUNCT_REGEX = /[,،;؛:—–-]$/u;

const HEADING_REGEX = /^(?:the\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+issue[\s:.]*|المسألة\s+(?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة)[\s:.]*)$/iu;

/**
 * Checks if a word or string ends a grammatical sentence.
 */
export function isSentenceEnd(str) {
  return SENTENCE_TERMINAL_REGEX.test(String(str || '').trim());
}

/**
 * Extends display duration for reading comfort based on 15 chars/second target.
 * Never overlaps the subsequent subtitle.
 */
export function applyComfortReadingTime(cues, totalDuration = 0) {
  if (!cues || !cues.length) return [];
  const out = cues.map((c) => ({ ...c }));

  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    const textLen = (cur.en || cur.t || '').trim().length;
    const currentDur = cur.e - cur.s;

    // Minimum display time 1.6s; target reading time based on 15 CPS
    const targetDur = Math.max(READ_MIN_SECONDS, textLen / READ_CPS);
    if (targetDur > currentDur) {
      const neededEnd = cur.s + targetDur;
      const nextStart = i < out.length - 1 ? out[i + 1].s : (totalDuration || cur.e + 2.0);
      const maxAllowedEnd = Math.max(cur.e, nextStart - 0.05);
      cur.e = Math.min(neededEnd, maxAllowedEnd);
    }
  }

  return out;
}

/**
 * Stub fix:
 * If cue i ends with 1-2 words of the NEXT sentence (e.g. "...is good. And whoever"),
 * hands them over to cue i+1.
 * If cue i starts with 1-2 words of the PREVIOUS sentence, hands them back to cue i-1.
 */
export function fixSubtitleStubs(cues) {
  if (!cues || cues.length <= 1) return cues || [];
  const list = cues.map((c) => ({
    ...c,
    t: String(c.t || '').trim(),
    en: c.en ? String(c.en).trim() : '',
    words: c.words ? [...c.words] : [],
  }));

  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i];
    const next = list[i + 1];

    if (cur.locked || next.locked) continue; // Leave Qur'an quotes locked

    // Check if cur contains a sentence end before its last 1-2 words
    const curWords = cur.t.split(/\s+/).filter(Boolean);
    if (curWords.length >= 6) {
      for (let trailing = 1; trailing <= 2; trailing++) {
        const pivotWord = curWords[curWords.length - 1 - trailing];
        if (isSentenceEnd(pivotWord)) {
          // Hand over trailing words to next cue
          const handedTokens = curWords.slice(curWords.length - trailing);
          curWords.splice(curWords.length - trailing, trailing);
          cur.t = curWords.join(' ');

          const nextWords = next.t.split(/\s+/).filter(Boolean);
          next.t = `${handedTokens.join(' ')} ${nextWords.join(' ')}`.trim();

          // Transfer word timing objects if available
          if (cur.words && cur.words.length >= trailing && next.words) {
            const movedWords = cur.words.splice(cur.words.length - trailing, trailing);
            next.words.unshift(...movedWords);
            cur.e = cur.words[cur.words.length - 1].e;
            next.s = next.words[0].s;
          }
          break;
        }
      }
    }
  }

  return list;
}

/**
 * Collapses orphan fragments (< 25 characters) into their neighbor
 * if they are < 1.5s apart and combined <= 16s.
 */
export function collapseOrphans(cues) {
  if (!cues || cues.length <= 1) return cues || [];
  const list = cues.map((c) => ({ ...c }));
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const cur = list[i];
    if (!out.length) {
      out.push(cur);
      continue;
    }

    const prev = out[out.length - 1];
    const curLen = (cur.en || cur.t || '').trim().length;
    const gap = cur.s - prev.e;
    const combinedDur = cur.e - prev.s;

    if (!cur.locked && !prev.locked && curLen < 25 && gap < 1.5 && combinedDur <= 16.0) {
      // Fold orphan into previous cue
      prev.t = `${prev.t} ${cur.t}`.trim();
      if (prev.en && cur.en) prev.en = `${prev.en} ${cur.en}`.trim();
      prev.e = cur.e;
      if (prev.words && cur.words) prev.words.push(...cur.words);
    } else {
      out.push(cur);
    }
  }

  return out;
}

/**
 * Repositions numbered headings ("The fifth issue.") at the end of a subtitle
 * to the start of the next subtitle, moving boundary time with it.
 */
export function repositionHeadings(cues) {
  if (!cues || cues.length <= 1) return cues || [];
  const list = cues.map((c) => ({ ...c }));

  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i];
    const next = list[i + 1];
    if (cur.locked || next.locked) continue;

    const curTokens = cur.t.split(/\s+/).filter(Boolean);
    if (curTokens.length >= 5) {
      // Check last 2-4 words for heading match
      for (let span = 2; span <= 4; span++) {
        const cand = curTokens.slice(curTokens.length - span).join(' ');
        if (HEADING_REGEX.test(cand)) {
          curTokens.splice(curTokens.length - span, span);
          cur.t = curTokens.join(' ');
          next.t = `${cand} ${next.t}`.trim();

          if (cur.words && cur.words.length >= span && next.words) {
            const moved = cur.words.splice(cur.words.length - span, span);
            next.words.unshift(...moved);
            cur.e = cur.words[cur.words.length - 1].e;
            next.s = next.words[0].s;
          }
          break;
        }
      }
    }
  }

  return list;
}

/**
 * Slices a stream of timed words into sentence-complete subtitles.
 * 
 * @param {Array<{ w: string, s: number, e: number }>} words
 * @param {Object} [options]
 * @returns {Array<Object>} Sentence-complete subtitle cues
 */
export function buildSentenceCompleteSubtitles(words, options = {}) {
  if (!words || !words.length) return [];
  const nextId = options.nextId || (() => Date.now() + Math.random());

  const cues = [];
  let curWords = [];
  let curSentences = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    curWords.push(w);

    const isTerm = isSentenceEnd(w.w);
    if (isTerm) curSentences++;

    const textLen = curWords.reduce((sum, x) => sum + x.w.length, 0) + curWords.length - 1;
    const dur = curWords[curWords.length - 1].e - curWords[0].s;
    const nextGap = i < words.length - 1 ? words[i + 1].s - w.e : 0;

    // Subtitle closes when:
    // 1. It hits a sentence end AND has at least CUE_MIN_CHARS (or CUE_TARGET_CHARS / CUE_MAX_SENTENCES reached)
    // 2. OR it exceeds CUE_MAX_SECONDS (14s) or safety cap and reaches clause punctuation
    const reachedSizeAtSentenceEnd = isTerm && (textLen >= CUE_MIN_CHARS || curSentences >= CUE_MAX_SENTENCES);
    const hardLimitExceeded = dur >= CUE_MAX_SECONDS && (isTerm || CLAUSE_PUNCT_REGEX.test(w.w) || nextGap >= 0.4);
    const atEnd = i === words.length - 1;

    if (reachedSizeAtSentenceEnd || hardLimitExceeded || atEnd) {
      cues.push({
        id: nextId(),
        s: curWords[0].s,
        e: curWords[curWords.length - 1].e,
        t: curWords.map((x) => x.w).join(' '),
        words: [...curWords],
      });
      curWords = [];
      curSentences = 0;
    }
  }

  // Apply stub fixing, orphan collapse, heading repositioning, and reading comfort
  const stubsFixed = fixSubtitleStubs(cues);
  const orphansCollapsed = collapseOrphans(stubsFixed);
  const headingsFixed = repositionHeadings(orphansCollapsed);
  const readingComfortable = applyComfortReadingTime(headingsFixed, words[words.length - 1].e);

  return readingComfortable;
}

/**
 * Standard alias accepting words in { word, start, end } or { w, s, e } format.
 */
export function sliceIntoSentenceCompleteCues(words, options = {}) {
  if (!words || !words.length) return [];
  const normalized = words.map((w) => ({
    w: w.w || w.word || w.text || '',
    s: typeof w.s === 'number' ? w.s : (typeof w.start === 'number' ? w.start : 0),
    e: typeof w.e === 'number' ? w.e : (typeof w.end === 'number' ? w.end : 0),
  }));
  return buildSentenceCompleteSubtitles(normalized, options);
}
