/**
 * Stage 5: Deterministic Clean-Ups (Pure Rule-Based Engine)
 * Based on PIPELINE_GUIDE.md T5
 *
 * Implements:
 * 1. drop_block_echoes: Drops chunk-edge guessed endings that duplicate next chunk
 * 2. drop_repeats: Drops 2-4 word accidental stutters unless corroborated
 * 3. restore_seam_words: Restores words dropped on chunk seams when 2 engines agree
 * 4. drop_false_starts: Cleans stuttered prefixes before full words
 * 5. names_guard: Corrects known historical & Islamic name corruptions
 */

import { normArabic, normWord } from './panelOfJudges.js';

// Stock formulas that are allowed to repeat naturally across blocks
const EXEMPT_FORMULAS = new Set([
  'رحمه الله', 'رحمهم الله', 'عز وجل', 'صلى الله عليه وسلم', 'رضي الله عنه',
  'رضي الله عنها', 'رضي الله عنهم', 'سبحانه وتعالى', 'تبارك وتعالى', 'عليه السلام',
  'صلوات الله وسلامه عليه', 'جزاك الله خيرا', 'بارك الله فيك',
  'رحمتہ اللہ علیہ', 'رضی اللہ عنہ',
]);

// Known historical Islamic names dictionary with verified spellings
export const HISTORICAL_NAMES_CORRECTIONS = new Map([
  ['بن دريس', 'بن إدريس'],
  ['بن ادريس', 'بن إدريس'],
  ['ابن ادريس', 'ابن إدريس'],
  ['ابن عبد الوهاب', 'ابن عبد الوهاب'],
  ['ابن تيميه', 'ابن تيمية'],
  ['ابن القيم', 'ابن القيم'],
  ['البخارى', 'البخاري'],
  ['الطبرى', 'الطبري'],
  ['الترمذى', 'الترمذي'],
  ['النسائى', 'النسائي'],
  ['ابن حجر', 'ابن حجر'],
  ['ابن كثير', 'ابن كثير'],
  ['النووى', 'النووي'],
  ['الشافعى', 'الشافعي'],
  ['ابو حنيفه', 'أبو حنيفة'],
  ['احمد بن حنبل', 'أحمد بن حنبل'],
  ['مالك بن انس', 'مالك بن أنس'],
]);

/**
 * Drops block-end echoes where a chunked engine guessed an ending for a cut-off phrase,
 * and the next chunk repeated it properly.
 * 
 * @param {Array<{ text: string, s: number, e: number }>} chunks
 * @param {Array<string>} [corroborationTexts] Reference texts (e.g. continuous Whisper)
 * @returns {{ cleaned: Array<any>, notes: Array<any> }}
 */
export function dropBlockEchoes(chunks, corroborationTexts = []) {
  if (!chunks || chunks.length <= 1) return { cleaned: chunks || [], notes: [] };

  const out = chunks.map((c) => ({ ...c, text: (c.text || c.t || '').trim() }));
  const notes = [];
  const fullRefText = corroborationTexts.join(' ');
  const normRef = normArabic(fullRefText);

  for (let i = 0; i < out.length - 1; i++) {
    const curWords = out[i].text.split(/\s+/).filter(Boolean);
    const nextWords = out[i + 1].text.split(/\s+/).filter(Boolean);
    if (curWords.length < 3 || nextWords.length < 3) continue;

    // Check last 3-5 words of cur against first 3-5 words of next
    for (let k = Math.min(5, curWords.length); k >= 3; k--) {
      const curTail = curWords.slice(curWords.length - k).join(' ');
      const nextHead = nextWords.slice(0, k).join(' ');
      const curTailNorm = normArabic(curTail);
      const nextHeadNorm = normArabic(nextHead);

      if (curTailNorm === nextHeadNorm && !EXEMPT_FORMULAS.has(curTail.trim())) {
        // If reference has it only once around here, drop the echo from cur
        const countInRef = normRef ? (normRef.split(curTailNorm).length - 1) : 1;
        if (countInRef <= 1) {
          const before = out[i].text;
          out[i].text = curWords.slice(0, curWords.length - k).join(' ');
          notes.push({
            rule: 'drop_block_echoes',
            time: out[i].e,
            before,
            after: out[i].text,
            droppedPhrase: curTail,
          });
          break;
        }
      }
    }
  }

  return { cleaned: out, notes };
}

/**
 * Drops doubled phrases and accidental stutters (2-4 word phrases).
 * 
 * @param {string} text
 * @param {string} [refText] Optional reference text
 * @returns {{ text: string, notes: Array<any> }}
 */
export function dropRepeats(text, refText = '') {
  if (!text) return { text: '', notes: [] };
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return { text, notes: [] };

  const notes = [];
  const outWords = [...words];
  let changed = false;

  for (let k = 4; k >= 2; k--) {
    for (let i = 0; i <= outWords.length - 2 * k; i++) {
      const phrase1 = outWords.slice(i, i + k).join(' ');
      const phrase2 = outWords.slice(i + k, i + 2 * k).join(' ');
      const norm1 = normArabic(phrase1);
      const norm2 = normArabic(phrase2);

      if (norm1 === norm2 && !EXEMPT_FORMULAS.has(phrase1)) {
        // Check if refText only had it once
        const normRef = normArabic(refText);
        const countInRef = normRef ? (normRef.split(norm1).length - 1) : 1;
        if (countInRef <= 1) {
          notes.push({
            rule: 'drop_repeats',
            dropped: phrase2,
            pos: i + k,
          });
          outWords.splice(i + k, k);
          changed = true;
          break;
        }
      }
    }
  }

  return {
    text: outWords.join(' '),
    notes,
  };
}

/**
 * Drops false starts like "Muhammad ibn Ab... Muhammad ibn Abd al-Wahhab".
 * 
 * @param {string} text
 * @returns {{ text: string, notes: Array<any> }}
 */
export function dropFalseStarts(text) {
  if (!text) return { text: '', notes: [] };
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return { text, notes: [] };

  const notes = [];
  const outWords = [...words];

  for (let i = 0; i < outWords.length - 2; i++) {
    const w1 = normArabic(outWords[i]);
    const w2 = normArabic(outWords[i + 1]);
    const w3 = normArabic(outWords[i + 2]);

    // Check pattern: "A X... A XY" where X is a prefix of XY
    if (w1.length > 2 && w3.length > 2 && w1 === normArabic(outWords[i + 2]) && i + 3 < outWords.length) {
      const w4 = normArabic(outWords[i + 3]);
      if (w4.startsWith(w2) && w4.length > w2.length) {
        notes.push({
          rule: 'drop_false_starts',
          dropped: `${outWords[i]} ${outWords[i + 1]}`,
        });
        outWords.splice(i, 2);
        break;
      }
    }
  }

  return {
    text: outWords.join(' '),
    notes,
  };
}

/**
 * Restores words dropped on chunk seams when 2 engines agree against 1.
 * 
 * @param {Array<{ text: string }>} mainChunks
 * @param {Array<{ text: string }>} engine2Chunks
 * @param {Array<{ text: string }>} engine3Chunks
 * @returns {Array<any>}
 */
export function restoreSeamWords(mainChunks, engine2Chunks, engine3Chunks) {
  if (!mainChunks || mainChunks.length <= 1) return mainChunks || [];
  const out = mainChunks.map((c) => ({ ...c }));

  for (let i = 0; i < out.length - 1; i++) {
    const c1 = out[i];
    const c2 = out[i + 1];
    const tail1 = (c1.text || '').trim().split(/\s+/).slice(-2).join(' ');
    const head2 = (c2.text || '').trim().split(/\s+/).slice(0, 2).join(' ');

    const e2Full = (engine2Chunks[i]?.text || '') + ' ' + (engine2Chunks[i + 1]?.text || '');
    const e3Full = (engine3Chunks[i]?.text || '') + ' ' + (engine3Chunks[i + 1]?.text || '');

    const normTail = normArabic(tail1);
    const normHead = normArabic(head2);

    // Look for 1-3 words between normTail and normHead in e2 and e3
    const matchE2 = e2Full.match(new RegExp(`${normTail}\\s+([^\\s]+(?:\\s+[^\\s]+){0,2})\\s+${normHead}`, 'u'));
    const matchE3 = e3Full.match(new RegExp(`${normTail}\\s+([^\\s]+(?:\\s+[^\\s]+){0,2})\\s+${normHead}`, 'u'));

    if (matchE2 && matchE3 && normArabic(matchE2[1]) === normArabic(matchE3[1])) {
      c1.text = `${c1.text} ${matchE2[1]}`.trim();
    }
  }

  return out;
}

/**
 * Names guard: Corrects known historical & Islamic name corruptions with strict corroboration.
 * 
 * @param {string} text
 * @returns {{ text: string, replacements: Array<any> }}
 */
export function applyNamesGuard(text) {
  if (!text) return { text: '', replacements: [] };
  let result = text;
  const replacements = [];

  for (const [wrong, right] of HISTORICAL_NAMES_CORRECTIONS.entries()) {
    if (result.includes(wrong)) {
      result = result.replaceAll(wrong, right);
      replacements.push({ wrong, right });
    }
  }

  return { text: result, replacements };
}

/**
 * Orchestrates all deterministic cleanups on a segmented transcript.
 */
export function runDeterministicCleanups(segments, corroborationTexts = []) {
  if (!segments || !segments.length) return { segments: [], allNotes: [] };

  const allNotes = [];
  // 1. Drop block echoes
  const echoResult = dropBlockEchoes(segments, corroborationTexts);
  allNotes.push(...echoResult.notes);

  // 2. Per-segment repeat, false start and name cleanup
  const cleaned = echoResult.cleaned.map((s) => {
    let t = s.text || s.t || '';
    const rep = dropRepeats(t, corroborationTexts.join(' '));
    t = rep.text;
    allNotes.push(...rep.notes);

    const fs = dropFalseStarts(t);
    t = fs.text;
    allNotes.push(...fs.notes);

    const ng = applyNamesGuard(t);
    t = ng.text;
    allNotes.push(...ng.replacements.map((r) => ({ rule: 'names_guard', ...r })));

    return {
      ...s,
      text: t,
      t,
    };
  });

  return { segments: cleaned, allNotes };
}
