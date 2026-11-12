/**
 * Structured Transcript & Translation Data Architecture (Engine 2.0)
 *
 * Implements:
 * 1) Structured Multi-Stage Document Representation:
 *    - Words (verbatim audio ground truth with timestamps [s, e])
 *    - Sentences (complete grammatical and rhetorical units)
 *    - Cues (viewer-facing 8-12 word subtitle segments)
 *    - Translations (full-thought translations mapped to cues)
 * 2) Persistent Islamic Terminology Glossary & Translation Memory
 * 3) Multi-stage Quality Validation (transcription, segmentation, translation, timing)
 */

import { HONORIFICS, isRtlBase, shapeBidiText, stripBidiControls } from '../bidiHelper.js';

export const DEFAULT_ISLAMIC_GLOSSARY = [
  { src: 'التوحيد', tr: 'Tawheed', note: 'Islamic Monotheism' },
  { src: 'الإخلاص', tr: 'Sincerity (Ikhlas)', note: 'Purity of intention' },
  { src: 'التقوى', tr: 'Taqwa', note: 'God-consciousness / Piety' },
  { src: 'أهل السنة', tr: 'Ahlus Sunnah', note: 'People of the Sunnah' },
  { src: 'أهل السنة والجماعة', tr: "Ahlus Sunnah wal-Jama'ah", note: 'Orthodox Muslim community' },
  { src: 'الصحابة', tr: 'The Companions (Sahabah)', note: 'Companions of the Prophet' },
  { src: 'السلف', tr: 'The Salaf', note: 'The early righteous generations' },
  { src: 'السلف الصالح', tr: 'As-Salaf As-Salih', note: 'The Pious Predecessors' },
  { src: 'رسول الله', tr: 'Messenger of Allah', note: 'Prophet Muhammad ﷺ' },
  { src: 'النبي', tr: 'The Prophet', note: 'Prophet Muhammad ﷺ' },
  { src: 'القرآن', tr: "The Qur'an", note: 'The Holy Book' },
  { src: 'حديث', tr: 'Hadith', note: 'Prophetic narration' },
  { src: 'سنة', tr: 'Sunnah', note: 'Prophetic practice' },
  { src: 'شريعة', tr: "Shari'ah", note: 'Islamic law' },
  { src: 'إيمان', tr: 'Iman', note: 'Faith' },
  { src: 'إسلام', tr: 'Islam', note: 'Submission to God' },
  { src: 'إحسان', tr: 'Ihsan', note: 'Excellence in worship' },
  { src: 'أبو بكر', tr: 'Abu Bakr', note: 'First Caliph' },
  { src: 'عمر بن الخطاب', tr: 'Umar ibn al-Khattab', note: 'Second Caliph' },
  { src: 'عثمان بن عفان', tr: 'Uthman ibn Affan', note: 'Third Caliph' },
  { src: 'علي بن أبي طالب', tr: 'Ali ibn Abi Talib', note: 'Fourth Caliph' },
  { src: 'الإمام البخاري', tr: 'Imam al-Bukhari', note: 'Hadith scholar' },
  { src: 'الإمام مسلم', tr: 'Imam Muslim', note: 'Hadith scholar' },
];

/**
 * Creates an empty or pre-populated structured TranscriptDocument.
 */
export function createTranscriptDocument(initial = {}) {
  return {
    version: '2.0',
    projectId: initial.projectId || null,
    audioDuration: initial.audioDuration || 0,
    language: initial.language || 'auto',
    detectedLanguage: initial.detectedLanguage || '',
    words: Array.isArray(initial.words) ? initial.words : [],
    sentences: Array.isArray(initial.sentences) ? initial.sentences : [],
    cues: Array.isArray(initial.cues) ? initial.cues : [],
    translations: Array.isArray(initial.translations) ? initial.translations : [],
    glossary: Array.isArray(initial.glossary) ? initial.glossary : [...DEFAULT_ISLAMIC_GLOSSARY],
    validation: {
      transcription: [],
      segmentation: [],
      translation: [],
      timing: [],
    },
    updatedAt: Date.now(),
  };
}

/**
 * Reconstructs complete grammatical sentences from a stream of verbatim words.
 * Combines sentence-ending punctuation [.!?؟۔…] and natural audio pause gaps (>= 0.75s).
 */
export function reconstructSentencesFromWords(words) {
  if (!words || !words.length) return [];
  const sentences = [];
  let cur = [];
  let sentIdx = 0;

  const flushSentence = () => {
    if (!cur.length) return;
    const s = cur[0].s;
    const e = cur[cur.length - 1].e;
    const text = cur.map((w) => w.w).join(' ').trim();
    sentences.push({
      id: sentIdx++,
      s,
      e,
      text,
      wordStartIdx: cur[0].globalIdx,
      wordEndIdx: cur[cur.length - 1].globalIdx,
      wordCount: cur.length,
      words: [...cur],
    });
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur.length ? cur[cur.length - 1] : null;
    const pauseGap = prev ? Math.max(0, w.s - prev.e) : 0;
    const isPunctEnd = /[.!?؟۔…]$/u.test(w.w);

    // If an unusually long pause occurred before this word, finish previous sentence
    if (cur.length && pauseGap >= 0.95 && cur.length >= 4) {
      flushSentence();
    }

    cur.push({ ...w, globalIdx: i });

    // Break on explicit sentence-ending punctuation if we have a reasonable clause length
    if (isPunctEnd && cur.length >= 3) {
      flushSentence();
    }
  }

  flushSentence();
  return sentences;
}

/**
 * Validates generated subtitle cues against professional subtitling standards.
 * Detects:
 * - Orphaned glue words (prepositions, articles, conjunctions) at segment ends
 * - Incomplete phrases
 * - Excessively short (< 3 words) or excessively long (> 15 words) cues
 * - Timing overlaps or negative durations
 */
export function validateSubtitleCues(cues) {
  const issues = [];
  const GLUE_END = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'to', 'into', 'onto',
    'and', 'or', 'but', 'because', 'since', 'while', 'when', 'which', 'that', 'who',
    'في', 'من', 'إلى', 'الى', 'على', 'عن', 'مع', 'عند', 'بين', 'حتى', 'أن', 'إن', 'و', 'أو', 'ثم',
    'اور', 'یا', 'لیکن', 'مگر', 'کیونکہ', 'کہ', 'کا', 'کی', 'کے', 'میں', 'سے', 'پر', 'کو',
  ]);

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const words = String(cue.t || '').trim().split(/\s+/).filter(Boolean);
    const dur = cue.e - cue.s;
    const lastWord = words.length ? words[words.length - 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
    const hasPunct = /[.!?؟۔…]$/u.test(cue.t || '');

    if (dur <= 0.1) {
      issues.push({ cueId: cue.id, type: 'timing', level: 'error', message: 'Duration is too short (< 0.1s)' });
    }
    if (i > 0 && cue.s < cues[i - 1].e - 0.05) {
      issues.push({ cueId: cue.id, type: 'timing', level: 'warning', message: 'Overlaps with preceding subtitle' });
    }
    if (words.length < 3 && !hasPunct && i < cues.length - 1) {
      issues.push({ cueId: cue.id, type: 'segmentation', level: 'warning', message: 'Segment is very short (< 3 words) without sentence punctuation' });
    }
    if (words.length > 15) {
      issues.push({ cueId: cue.id, type: 'segmentation', level: 'warning', message: 'Segment exceeds recommended length (> 15 words)' });
    }
    if (GLUE_END.has(lastWord) && i < cues.length - 1) {
      issues.push({ cueId: cue.id, type: 'segmentation', level: 'warning', message: `Ends on trailing connective "${lastWord}" — consider joining with next cue` });
    }
  }

  return issues;
}

/**
 * Builds structured paragraph units for Context-Aware Translation.
 * Groups 1 to 3 full sentences into a cohesive paragraph unit (~35-90 words).
 * Each unit references its constituent sentence IDs and cue IDs.
 */
export function buildParagraphTranslationUnits(sentences, cues) {
  if (!sentences || !sentences.length) return [];
  const units = [];
  let curSentences = [];
  let wordCount = 0;
  let unitId = 0;

  const flushUnit = () => {
    if (!curSentences.length) return;
    const s = curSentences[0].s;
    const e = curSentences[curSentences.length - 1].e;
    const fullSource = curSentences.map((st) => st.text).join(' ');
    const sentIds = curSentences.map((st) => st.id);
    const relatedCues = cues.filter((c) => c.s >= s - 0.15 && c.e <= e + 0.15);

    units.push({
      id: unitId++,
      s,
      e,
      sourceText: fullSource,
      sentenceIds: sentIds,
      cueIds: relatedCues.map((c) => c.id),
      cuesCount: relatedCues.length,
      translatedText: '',
      validated: false,
    });
    curSentences = [];
    wordCount = 0;
  };

  for (const sent of sentences) {
    curSentences.push(sent);
    wordCount += sent.wordCount;
    // Batch into natural paragraph chunks (~35-80 words or maximum 3 sentences)
    if (wordCount >= 40 || curSentences.length >= 3) {
      flushUnit();
    }
  }

  flushUnit();
  return units;
}

/**
 * Formats a glossary into translation prompt injection text.
 */
export function formatGlossaryPrompt(glossary = []) {
  if (!glossary || !glossary.length) return '';
  const lines = glossary
    .map((g) => `- "${g.src}" => "${g.tr}"${g.note ? ` (${g.note})` : ''}`)
    .slice(0, 40);
  return 'ISLAMIC TERMINOLOGY MEMORY (Strictly preserve):\n' + lines.join('\n');
}

/**
 * Maps a complete translated paragraph back to its constituent subtitle cues
 * proportionally by source timing while preserving target sentence structure.
 */
export function mapTranslatedThoughtToCues(translatedText, cues) {
  if (!cues || !cues.length) return [];
  const cleanTr = stripBidiControls(String(translatedText || '').trim());
  if (cues.length === 1) {
    return [{ cueId: cues[0].id, tr: shapeBidiText(cleanTr) }];
  }

  // If translation contains explicit reveal pipe markers "|", split on them
  if (cleanTr.includes('|')) {
    const parts = cleanTr.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length === cues.length) {
      return cues.map((c, i) => ({ cueId: c.id, tr: shapeBidiText(parts[i]) }));
    }
  }

  // Proportional token division according to source cue durations
  const tokens = cleanTr.split(/\s+/).filter(Boolean);
  const totalDur = cues.reduce((sum, c) => sum + Math.max(0.2, c.e - c.s), 0);
  const result = [];
  let tokenCursor = 0;
  let accDur = 0;

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    accDur += Math.max(0.2, c.e - c.s);
    const targetTokenEnd = i === cues.length - 1
      ? tokens.length
      : Math.min(tokens.length, Math.round((accDur / totalDur) * tokens.length));

    const slice = tokens.slice(tokenCursor, targetTokenEnd);
    tokenCursor = targetTokenEnd;
    result.push({
      cueId: c.id,
      tr: shapeBidiText(slice.join(' ')),
    });
  }

  return result;
}
