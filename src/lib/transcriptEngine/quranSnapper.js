/**
 * Stage 7: Qur'an Ground Truth Snapping Engine
 * Based on PIPELINE_GUIDE.md Section S4 and Appendix A
 *
 * Implements:
 * 1. Seed-and-extend trigram search in Uthmani Arabic corpus
 * 2. Introductory tell detection ("قال الله تعالى", "في قول الله", "كما في كتاب الله")
 * 3. Locked Hilali-Khan English translation per ayah with canonical citation (Surah:Ayah)
 * 4. Du'a protection (preserves personal du'as as du'as)
 * 5. Hadith quote protection (prevents snapping Prophet ﷺ quotations as Qur'an)
 * 6. High reading comfort display formatting (up to 20 CPS allowed for recitation)
 */

import { normArabic } from './panelOfJudges.js';
import { QURAN_AYAT_DATABASE } from './quranData.js';

// Introductory tells that signal an upcoming Qur'an quote
export const QURAN_TELLS = [
  'قال الله تعالى',
  'قال الله عز وجل',
  'قال الله سبحانه',
  'قوله تعالى',
  'قوله عز وجل',
  'في قول الله',
  'في كتاب الله',
  'كما في كتاب الله',
  'لقوله تعالى',
  'يقول الحق سبحانه',
  'يقول الله تبارك وتعالى',
  'يقول الله تعالى',
  'في سورة',
];

// Trigram inverted index: Map<trigramKey, Array<{ s, a, wordIdx, entry }>>
let trigramIndex = null;

function buildTrigramIndex() {
  if (trigramIndex) return trigramIndex;
  trigramIndex = new Map();

  for (const item of QURAN_AYAT_DATABASE) {
    const words = normArabic(item.ar).split(/\s+/).filter(Boolean);
    for (let i = 0; i <= words.length - 3; i++) {
      const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (!trigramIndex.has(tri)) trigramIndex.set(tri, []);
      trigramIndex.get(tri).push({ s: item.s, a: item.a, wordIdx: i, entry: item, words });
    }
  }

  return trigramIndex;
}

/**
 * Checks if two Arabic words match, tolerating leading prefixes (و/ف/ل/ب)
 * and minor hamza/alif spelling variants.
 */
function wordTolerantMatch(transcriptWord, quranWord) {
  if (transcriptWord === quranWord) return true;
  if (!transcriptWord || !quranWord) return false;

  // Attached wa/fa/la/bi
  if (transcriptWord.length > quranWord.length && (transcriptWord.startsWith('و') || transcriptWord.startsWith('ف') || transcriptWord.startsWith('ل') || transcriptWord.startsWith('ب'))) {
    if (transcriptWord.slice(1) === quranWord) return true;
  }
  if (quranWord.length > transcriptWord.length && (quranWord.startsWith('و') || quranWord.startsWith('ف') || quranWord.startsWith('ل') || quranWord.startsWith('ب'))) {
    if (quranWord.slice(1) === transcriptWord) return true;
  }

  return false;
}

/**
 * Checks whether speech context contains an introductory tell.
 */
export function hasIntroductoryTell(textBefore) {
  if (!textBefore) return false;
  const norm = normArabic(textBefore);
  return QURAN_TELLS.some((tell) => norm.includes(normArabic(tell)));
}

/**
 * Checks whether the segment is a personal du'a that should not be snapped.
 */
export function isPersonalDua(text) {
  if (!text) return false;
  const norm = normArabic(text);
  return norm.startsWith('ربنا') || norm.startsWith('اللهم') || norm.startsWith('ربي');
}

/**
 * Checks whether the quote is introduced as a Hadith ("قال رسول الله").
 */
export function isHadithQuote(textBefore) {
  if (!textBefore) return false;
  const norm = normArabic(textBefore);
  return (
    norm.includes('قال رسول الله') ||
    norm.includes('قال النبي') ||
    norm.includes('عن رسول الله') ||
    norm.includes('عن النبي')
  );
}

/**
 * Finds matching Qur'an verses in a stream of words using the seed-and-extend algorithm.
 * 
 * @param {Array<{ w: string, s: number, e: number }>} words
 * @param {string} [contextBefore] Preceding text to check for introductory tells
 * @returns {Array<{ startIdx: number, endIdx: number, surah: number, ayah: number, score: number, entry: Object }>}
 */
export function findQuranQuotesInWords(words, contextBefore = '') {
  if (!words || words.length < 3) return [];
  const index = buildTrigramIndex();
  const normTokens = words.map((w) => normArabic(w.w));
  const matches = [];

  for (let i = 0; i <= normTokens.length - 3; i++) {
    const tri = `${normTokens[i]} ${normTokens[i + 1]} ${normTokens[i + 2]}`;
    const hits = index.get(tri);
    if (!hits || !hits.length) continue;

    for (const hit of hits) {
      // Seed matched! Extend backwards and forwards
      const ayahWords = hit.words;
      let qStart = hit.wordIdx;
      let qEnd = hit.wordIdx + 3;
      let tStart = i;
      let tEnd = i + 3;

      // Extend backwards
      while (tStart > 0 && qStart > 0) {
        if (wordTolerantMatch(normTokens[tStart - 1], ayahWords[qStart - 1])) {
          tStart--;
          qStart--;
        } else {
          break;
        }
      }

      // Extend forwards
      let misses = 0;
      while (tEnd < normTokens.length && qEnd < ayahWords.length && misses < 2) {
        if (wordTolerantMatch(normTokens[tEnd], ayahWords[qEnd])) {
          tEnd++;
          qEnd++;
          misses = 0;
        } else {
          misses++;
          tEnd++;
          qEnd++;
        }
      }

      const matchedCount = (tEnd - tStart) - misses;
      const score = matchedCount / ayahWords.length;
      const hasTell = hasIntroductoryTell(contextBefore || (words.slice(0, tStart).map((x) => x.w).join(' ')));
      const isHadith = isHadithQuote(words.slice(Math.max(0, tStart - 6), tStart).map((x) => x.w).join(' '));
      const isDua = isPersonalDua(words.slice(tStart, tEnd).map((x) => x.w).join(' '));

      // Decision rules:
      // - Do not snap if it's a hadith or personal dua
      if (isHadith || isDua) continue;

      // - With a tell: accept from 4 words or score >= 0.70
      // - Without a tell: accept from 7+ words or score >= 0.85
      const accept = hasTell ? (matchedCount >= 4 || score >= 0.7) : (matchedCount >= 7 || score >= 0.85);

      if (accept) {
        matches.push({
          startIdx: tStart,
          endIdx: tEnd,
          surah: hit.s,
          ayah: hit.a,
          score,
          matchedCount,
          entry: hit.entry,
        });
      }
    }
  }

  // Deduplicate and resolve overlapping matches by taking the highest-scoring/longest match
  if (!matches.length) return [];
  matches.sort((a, b) => b.matchedCount - a.matchedCount || b.score - a.score);

  const nonOverlapping = [];
  for (const m of matches) {
    const overlaps = nonOverlapping.some((ex) => !(m.endIdx <= ex.startIdx || m.startIdx >= ex.endIdx));
    if (!overlaps) nonOverlapping.push(m);
  }

  return nonOverlapping.sort((a, b) => a.startIdx - b.startIdx);
}

/**
 * Snaps detected Qur'an verses into locked, trusted subtitle units.
 * 
 * @param {Array<{ id: any, s: number, e: number, t: string, words?: Array<any> }>} cues
 * @returns {{ snappedCues: Array<any>, snapLog: Array<any> }}
 */
export function snapQuranQuotes(cues) {
  if (!cues || !cues.length) return { snappedCues: cues || [], snapLog: [] };

  const allWords = [];
  for (const cue of cues) {
    if (cue.words && cue.words.length) {
      allWords.push(...cue.words);
    } else {
      const tokens = (cue.t || '').trim().split(/\s+/).filter(Boolean);
      const dur = cue.e - cue.s;
      for (let i = 0; i < tokens.length; i++) {
        allWords.push({
          w: tokens[i],
          s: cue.s + (dur * i) / tokens.length,
          e: cue.s + (dur * (i + 1)) / tokens.length,
        });
      }
    }
  }

  const quotes = findQuranQuotesInWords(allWords);
  if (!quotes.length) return { snappedCues: cues, snapLog: [] };

  const snapLog = [];
  const outCues = [];
  let wordCursor = 0;

  for (const q of quotes) {
    // 1. Cues before the quote
    if (q.startIdx > wordCursor) {
      const preWords = allWords.slice(wordCursor, q.startIdx);
      if (preWords.length) {
        outCues.push({
          id: Date.now() + Math.random(),
          s: preWords[0].s,
          e: preWords[preWords.length - 1].e,
          t: preWords.map((x) => x.w).join(' '),
          words: preWords,
          isQuran: false,
        });
      }
    }

    // 2. The locked Qur'an quote
    const qWords = allWords.slice(q.startIdx, q.endIdx);
    const startS = qWords.length ? qWords[0].s : cues[0].s;
    const endE = qWords.length ? qWords[qWords.length - 1].e : cues[0].e;
    const refTag = `(${q.surah}:${q.ayah})`;

    outCues.push({
      id: Date.now() + Math.random(),
      s: startS,
      e: endE,
      t: `${q.entry.ar} ${refTag}`,
      en: `"${q.entry.en}" ${refTag}`,
      orig: q.entry.ar,
      words: qWords,
      isQuran: true,
      locked: true,
      citation: refTag,
      surah: q.surah,
      ayah: q.ayah,
    });

    snapLog.push({
      surah: q.surah,
      ayah: q.ayah,
      citation: refTag,
      start: startS,
      end: endE,
      arabic: q.entry.ar,
      english: q.entry.en,
    });

    wordCursor = q.endIdx;
  }

  // Remaining words after the last quote
  if (wordCursor < allWords.length) {
    const postWords = allWords.slice(wordCursor);
    if (postWords.length) {
      outCues.push({
        id: Date.now() + Math.random(),
        s: postWords[0].s,
        e: postWords[postWords.length - 1].e,
        t: postWords.map((x) => x.w).join(' '),
        words: postWords,
        isQuran: false,
      });
    }
  }

  return { snappedCues: outCues, snapLog };
}
