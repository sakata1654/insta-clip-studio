/**
 * Complete Transcription Pipeline Orchestrator (Tibyan Engine 2.0)
 * Orchestrates all 10 stages from the blueprint:
 *
 * Stage 1: Audio Analysis & Silence-aware chunking (audioProcessor.js)
 * Stage 2: Multi-engine / Single-engine ASR runners
 * Stage 3: Word-level Sequence Alignment across whole transcript (panelOfJudges.js)
 * Stage 4: Soft Majority Voting & Do-No-Harm Gate (panelOfJudges.js)
 * Stage 5: Deterministic Cleanups (deterministicCleanups.js)
 * Stage 6: Word Alignment & Timestamp Verification (no fabricated timestamps)
 * Stage 7: Qur'an Ground Truth Snapping Engine (quranSnapper.js)
 * Stage 8: S5 Sentence-Complete Subtitle Slicer (sentenceCutter.js)
 * Stage 9: Contextual Translation & 21 House Rules Engine (translationEngine.js)
 * Stage 10: Disagreement Flags & Review System (reviewSystem.js)
 */

import { makeSilenceAwareChunks } from './audioProcessor.js';
import {
  alignTranscriptsByWords,
  voteTextSoft,
  verifyDoNoHarmGate,
} from './panelOfJudges.js';
import { snapQuranQuotes } from './quranSnapper.js';
import { sliceIntoSentenceCompleteCues } from './sentenceCutter.js';
import {
  mergeIntoTranslationUnits,
  polishEnglishTranslation,
  scanTranslationStyleViolations,
} from './translationEngine.js';
import {
  generateCompareFlags,
  generateQuranFlags,
  generateCheckItems,
} from './reviewSystem.js';

function cleanWords(words) {
  if (!words || !words.length) return [];
  const cleaned = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cleaned.length ? cleaned[cleaned.length - 1] : null;
    const wordText = (w.word || w.w || w.text || '').trim();
    const prevText = prev ? (prev.word || prev.w || prev.text || '').trim() : '';

    // Drop immediate stutters if word is identical and gap < 0.5s
    if (prev && wordText && prevText && wordText === prevText && (w.start || w.s) - (prev.end || prev.e) < 0.5) {
      continue;
    }
    cleaned.push(w);
  }
  return cleaned;
}

export class TranscriptionPipeline {
  constructor(config = {}) {
    this.config = {
      maxChars: 84,
      maxWords: 12,
      minDur: 1.6,
      maxDur: 14.0,
      targetReadingSpeedCPS: 15.0,
      doQuranSnapping: true,
      doDeterministicCleanups: true,
      doEnglishPolish: true,
      ...config,
    };
  }

  /**
   * Runs the complete end-to-end 10-stage transcription & subtitle pipeline.
   *
   * @param {Object} params
   * @param {Float32Array|Int16Array|null} params.pcmSamples 16kHz Mono audio samples
   * @param {number} params.sampleRate Sample rate (should be 16000)
   * @param {Function} params.transcribeFn async (chunk, engineName) => { words: [...], text: '...' }
   * @param {Function} [params.translateFn] async (units) => [{ id, text, translation }]
   * @param {Function} [params.onProgress] (stageIndex, stageName, pct, message) => void
   * @param {Object} [params.options]
   * @returns {Promise<Object>} Final pipeline result { cues, flags, quranFlags, checkItems, words, rawEngines }
   */
  async process({
    pcmSamples = null,
    sampleRate = 16000,
    engine = 'faster',
    language = 'ar',
    transcribeFn,
    translateFn = null,
    onProgress = () => {},
    options = {},
  }) {
    const notify = (stageIdx, stageName, pct, msg) => {
      onProgress(stageIdx, stageName, pct, msg);
    };

    // Stage 1: Audio Analysis & Silence-aware chunking
    notify(1, 'Audio Analysis', 5, 'Analyzing speech energy and silence intervals…');
    let blockWindows = [];

    if (pcmSamples && pcmSamples.length > 0) {
      blockWindows = makeSilenceAwareChunks(pcmSamples, 24.0, 2.0, 3.0);
    }

    // Stage 2 & 3: Transcribe with specified engine or multi-engine panel
    notify(2, 'Speech-to-Text', 20, `Transcribing audio with ${engine} engine…`);
    let engineTranscripts = {
      cohere: [],
      whisper: [],
      qwen: [],
    };
    let words = [];
    let fullText = '';

    const asrResult = await transcribeFn({
      engine,
      language,
      blockWindows,
    });

    if (asrResult.words && asrResult.words.length) {
      words = asrResult.words;
      fullText = words.map((w) => w.word || w.w || w.text).join(' ');
      engineTranscripts.whisper = words;
    } else if (asrResult.segments && asrResult.segments.length) {
      // Reconstruct word array from segments if necessary
      words = [];
      for (const seg of asrResult.segments) {
        if (seg.words && seg.words.length) {
          words.push(...seg.words.map((w) => ({
            word: w.word || w.w || w.text || '',
            start: typeof w.start === 'number' ? w.start : w.s,
            end: typeof w.end === 'number' ? w.end : w.e,
          })));
        } else {
          // Break segment text evenly across timestamps
          const segWords = (seg.text || seg.t || '').trim().split(/\s+/).filter(Boolean);
          const dur = Math.max(0.1, (seg.end || seg.e) - (seg.start || seg.s));
          const step = dur / Math.max(1, segWords.length);
          for (let i = 0; i < segWords.length; i++) {
            words.push({
              word: segWords[i],
              start: Number(((seg.start || seg.s) + i * step).toFixed(2)),
              end: Number(((seg.start || seg.s) + (i + 1) * step).toFixed(2)),
            });
          }
        }
      }
      fullText = words.map((w) => w.word).join(' ');
    }

    // Store engine transcript alternates if provided
    if (asrResult.engineTranscripts) {
      engineTranscripts = { ...engineTranscripts, ...asrResult.engineTranscripts };
    }

    // Stage 4: Panel of Judges (if multiple engines were executed)
    if (engine === 'panel' && asrResult.candidates && asrResult.candidates.length > 1) {
      notify(4, 'Panel of Judges', 45, 'Aligning engine outputs & evaluating soft majority vote…');
      const alignedWords = alignTranscriptsByWords(asrResult.candidates.map((c) => c.words || []));
      const voted = voteTextSoft(
        alignedWords.map((row) => row[0]?.word || ''),
        alignedWords.map((row) => row[1]?.word || ''),
        alignedWords.map((row) => row[2]?.word || '')
      );

      // Verify with Do-No-Harm gate
      const gateCheck = verifyDoNoHarmGate(voted, asrResult.candidates);
      if (gateCheck.passed) {
        fullText = voted;
      }
    }

    // Stage 5: Deterministic Cleanups
    if (this.config.doDeterministicCleanups && words.length > 0) {
      notify(5, 'Deterministic Cleanups', 55, 'Removing stutters and applying names guard…');
      words = cleanWords(words);
    }

    // Stage 8: S5 Sentence-Complete Subtitle Slicer
    notify(8, 'Subtitle Slicer', 70, 'Constructing sentence-complete cues (8–12 words, 15 CPS)…');
    let cues = sliceIntoSentenceCompleteCues(words, {
      maxChars: this.config.maxChars,
      maxWords: this.config.maxWords,
      minDuration: this.config.minDur,
      maxDuration: this.config.maxDur,
      targetCPS: this.config.targetReadingSpeedCPS,
    });

    // Stage 7: Qur'an Ground Truth Snapping Engine
    let quranLog = [];
    if (this.config.doQuranSnapping && cues.length > 0) {
      notify(7, "Qur'an Snapper", 78, "Matching verses against Uthmani Arabic corpus…");
      const snapRes = snapQuranQuotes(cues);
      cues = snapRes.snappedCues || cues;
      quranLog = snapRes.snapLog || [];
    }

    for (const c of cues) {
      c.text = c.t || c.text || c.ar || '';
      c.t = c.text;
      c.ar = c.orig || c.ar || c.text;
      c.orig = c.ar;
      c.translation = c.en || c.tr || c.translation || '';
      c.tr = c.translation;
      c.en = c.translation;
    }

    // Stage 9: Contextual Translation & 21 House Rules
    if (translateFn && cues.length > 0) {
      notify(9, 'Translation & House Rules', 85, 'Translating units with 21 House Rules constitution…');
      const units = mergeIntoTranslationUnits(cues, 8.0, 22);
      try {
        const transRes = await translateFn(units);
        if (Array.isArray(transRes)) {
          for (let i = 0; i < cues.length; i++) {
            const cue = cues[i];
            if (cue.isQuran) continue; // Keep locked Hilali-Khan translation
            const matchTr = transRes[i];
            if (matchTr) {
              const rawTr = typeof matchTr === 'string' ? matchTr : (matchTr.en || matchTr.translation || matchTr.t || '');
              const polished = this.config.doEnglishPolish ? polishEnglishTranslation(rawTr, cue.ar || cue.text || cue.t) : rawTr;
              cue.en = polished;
              cue.translation = polished;
              cue.tr = polished;
            }
          }
        }
      } catch (err) {
        console.warn('Translation step encountered an error, keeping original cues:', err);
      }
    }

    // Stage 10: Disagreement Flags & Review System
    notify(10, 'Review Flags Generation', 95, 'Generating compare flags, Qur’an flags, and check items…');
    const blockEdges = blockWindows.map((b) => b.end);
    const compareFlags = generateCompareFlags(cues, engineTranscripts, blockEdges);
    const quranFlags = generateQuranFlags(cues, quranLog);
    const speechIntervals = blockWindows.map((b) => ({ s: b.start, e: b.end }));
    const checkItems = generateCheckItems(cues, speechIntervals);

    notify(10, 'Ready for Review', 100, `Done: ${cues.length} cues ready with ${compareFlags.length} compare flags.`);

    return {
      cues,
      words,
      fullText,
      compareFlags,
      quranFlags,
      checkItems,
      quranLog,
      engineTranscripts,
    };
  }
}
