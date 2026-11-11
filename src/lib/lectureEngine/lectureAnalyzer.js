import { aiCallJson } from '../prompts.js';
import {
  CONTENT_CATEGORIES,
  createDefaultProfile,
  hashTranscript,
  loadCachedLectureAnalysis,
  loadTrainerProfile,
  saveCachedLectureAnalysis,
  saveTrainerProfile,
  todayKey,
} from './lectureStorage.js';
import {
  getEffectivePreferences,
  runSelfTrainingReflection,
  scoreClipWithPersonalizedRanker,
} from './preferenceLearning.js';
import { recordLectureBatchSummary, retrieveRelevantExamples } from './exampleRetrieval.js';

const CONTINUATION_RE =
  /^(?:and|but|so|or|because|then|which|that|however|also|meanwhile|although|yet|nor|since|while|when|actually|literally|basically|therefore|moreover|furthermore|instead|anyway|still|even|wait|uh|um|و|ثم|لكن|لأن|أو|فإن|بل|اور|لیکن|کیونکہ|تو|پھر|مگر)\b/iu;

const SENTENCE_END_RE = /[.!?؟۔…]["'”’)\]]*$/u;
const CLAUSE_END_RE = /[,،؛:—–-]["'”’)\]]*$/u;
const WEAK_PRONOUN_START_RE = /^(?:he|she|they|it|this|that|these|those|him|her|them|his|their|its)\b/i;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function fmtSec(s) {
  s = Math.max(0, Number(s) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatCueLines(cues) {
  return cues
    .map((c) => {
      const tags = [];
      if (c.gapBeforeMs >= 450) tags.push(`pauseBefore=${c.gapBeforeMs}ms`);
      if (c.gapAfterMs >= 450) tags.push(`pauseAfter=${c.gapAfterMs}ms`);
      if (c.endsSentence) tags.push('sentenceEnd');
      if (c.startsContinuation) tags.push('contStart');
      return `[${c.idx}] (${fmtSec(c.s)}-${fmtSec(c.e)}${tags.length ? ' | ' + tags.join(', ') : ''}) ${c.text}`;
    })
    .join('\n');
}

export function prepareCueTranscript(subs = []) {
  const sorted = [...(subs || [])]
    .filter((x) => Number.isFinite(+x?.s) && Number.isFinite(+x?.e) && +x.e > +x.s && String(x.orig ?? x.t ?? '').trim())
    .sort((a, b) => +a.s - +b.s);

  const cues = sorted.map((x, i) => {
    const s = +x.s;
    const e = +x.e;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const text = String(x.orig ?? x.t ?? '').replace(/\s+/g, ' ').trim();
    const gapBeforeMs = i === 0 ? 1500 : Math.max(0, Math.round((s - +prev.e) * 1000));
    const gapAfterMs = i === sorted.length - 1 ? 1500 : Math.max(0, Math.round((+next.s - e) * 1000));
    return {
      idx: i + 1,
      s,
      e,
      text,
      gapBeforeMs,
      gapAfterMs,
      endsSentence: SENTENCE_END_RE.test(text),
      endsClause: CLAUSE_END_RE.test(text),
      startsContinuation: CONTINUATION_RE.test(text),
    };
  });

  const formattedTranscript = formatCueLines(cues);
  const transcriptHash = hashTranscript(cues.map((c) => `${c.idx}:${c.text}`).join('|'));
  return { cues, formattedTranscript, transcriptHash };
}

function findNearestCueIndexByTime(cues, t, mode = 'start') {
  if (!cues.length) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < cues.length; i++) {
    const ref = mode === 'end' ? cues[i].e : cues[i].s;
    const d = Math.abs(ref - t);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Deterministic Context-Aware Pause & Sentence Boundary Snapper.
 */
export function snapClipBoundaries(candidate, cues, totalDur = 0, profile = createDefaultProfile(), opts = {}) {
  if (!cues.length) return null;
  const minSec = Math.max(10, Number(opts.minSec) || 20);
  const maxSec = Math.max(minSec + 10, Number(opts.maxSec) || 140);
  const maxTotal = totalDur > 0 ? totalDur : cues[cues.length - 1].e + 0.5;
  const effPrefs = getEffectivePreferences(profile, opts.category || candidate?.category || 'general');

  let si = Number.isInteger(+candidate?.start_cue) ? clamp(+candidate.start_cue - 1, 0, cues.length - 1) : null;
  let ei = Number.isInteger(+candidate?.end_cue) ? clamp(+candidate.end_cue - 1, 0, cues.length - 1) : null;

  if (si === null && Number.isFinite(+candidate?.start_seconds)) si = findNearestCueIndexByTime(cues, +candidate.start_seconds, 'start');
  if (ei === null && Number.isFinite(+candidate?.end_seconds)) ei = findNearestCueIndexByTime(cues, +candidate.end_seconds, 'end');
  if (si === null) si = 0;
  if (ei === null) ei = si;
  if (ei < si) [si, ei] = [ei, si];

  const curDur = () => cues[ei].e - cues[si].s;
  const isCleanStart = (idx) => {
    if (idx === 0) return true;
    const c = cues[idx];
    const prev = cues[idx - 1];
    return prev.endsSentence || c.gapBeforeMs >= 420 || !c.startsContinuation;
  };
  const isCleanEnd = (idx) => {
    if (idx >= cues.length - 1) return true;
    const c = cues[idx];
    return c.endsSentence || c.gapAfterMs >= 480;
  };

  let contextExpanded = false;

  // 1. Repair mid-sentence/continuation/unexplained pronoun start
  if (!isCleanStart(si) || WEAK_PRONOUN_START_RE.test(cues[si].text)) {
    let repaired = false;
    for (let k = si - 1; k >= Math.max(0, si - 3); k--) {
      if (isCleanStart(k) && !WEAK_PRONOUN_START_RE.test(cues[k].text) && cues[ei].e - cues[k].s <= maxSec) {
        si = k;
        repaired = true;
        contextExpanded = true;
        break;
      }
    }
    if (!repaired && si + 1 <= ei && isCleanStart(si + 1) && cues[ei].e - cues[si + 1].s >= minSec) {
      si = si + 1;
    }
  } else if (effPrefs.contextLeadPreference >= 0.7 && si > 0 && !cues[si - 1].endsSentence && curDur() < maxSec - 6) {
    // Learned user preference: when creator strongly prefers context intro & previous cue is incomplete sentence lead-in, pull 1 cue back
    if (cues[ei].e - cues[si - 1].s <= maxSec) {
      si = si - 1;
      contextExpanded = true;
    }
  }

  // 2. Repair incomplete ending so conclusions/explanations are never cut mid-thought
  if (!isCleanEnd(ei)) {
    let repaired = false;
    for (let k = ei + 1; k <= Math.min(cues.length - 1, ei + 4); k++) {
      if (isCleanEnd(k) && cues[k].e - cues[si].s <= maxSec) {
        ei = k;
        repaired = true;
        break;
      }
    }
    if (!repaired) {
      for (let k = ei - 1; k >= Math.max(si, ei - 2); k--) {
        if (isCleanEnd(k) && cues[k].e - cues[si].s >= minSec) {
          ei = k;
          break;
        }
      }
    }
  }

  while (curDur() < minSec && ei < cues.length - 1) {
    if (cues[ei + 1].e - cues[si].s > maxSec) break;
    ei += 1;
    if (isCleanEnd(ei) && curDur() >= minSec) break;
  }
  while (curDur() > maxSec && ei > si) {
    ei -= 1;
  }

  const startCue = cues[si];
  const endCue = cues[ei];
  const startBias = clamp(Number(effPrefs.startOffsetBiasSec) || 0, -0.6, 0.6);
  const endBias = clamp(Number(effPrefs.endOffsetBiasSec) || 0, -0.6, 0.6);

  const maxPre = si === 0 ? Math.min(0.45, startCue.s) : Math.max(0.02, (startCue.gapBeforeMs / 1000) * 0.6);
  const prePad = clamp(0.18 - startBias, 0.02, Math.min(0.55, maxPre));
  const maxPost =
    ei === cues.length - 1
      ? Math.min(0.65, Math.max(0.1, maxTotal - endCue.e))
      : Math.max(0.04, (endCue.gapAfterMs / 1000) * 0.65);
  const postPad = clamp(0.25 + endBias, 0.04, Math.min(0.7, maxPost));

  const start_seconds = round2(Math.max(0, startCue.s - prePad));
  const end_seconds = round2(Math.min(maxTotal, Math.max(start_seconds + 0.5, endCue.e + postPad)));
  const startClean = isCleanStart(si) && !WEAK_PRONOUN_START_RE.test(startCue.text);
  const endClean = isCleanEnd(ei);

  return {
    id: candidate?.id || `clip_${startCue.idx}_${endCue.idx}`,
    title: String(candidate?.title || 'Untitled Reel').trim(),
    topic: String(candidate?.topic || '').trim(),
    moment_type: String(candidate?.moment_type || 'explanation').trim(),
    category: candidate?.category || opts.category || 'general',
    summary: String(candidate?.summary || candidate?.hook_reason || '').trim(),
    hook_reason: String(candidate?.hook_reason || '').trim(),
    ending_reason: String(candidate?.ending_reason || '').trim(),
    critic_note: String(candidate?.critic_note || '').trim(),
    hook_grade: String(candidate?.hook_grade || (startClean ? 'Natural Opening' : 'Check Opening')).trim(),
    ending_grade: String(candidate?.ending_grade || (endClean ? 'Complete Thought' : 'Open Tail')).trim(),
    start_cue: startCue.idx,
    end_cue: endCue.idx,
    start_seconds,
    end_seconds,
    opening_text: startCue.text,
    closing_text: endCue.text,
    context_before: si > 0 ? cues[si - 1].text : '',
    context_after: ei < cues.length - 1 ? cues[ei + 1].text : '',
    starts_continuation: startCue.startsContinuation,
    context_expanded: contextExpanded,
    boundary_clean: startClean && endClean,
    critical_scores: candidate?.critical_scores || null,
    scores: candidate?.scores || null,
    quality_score: clamp(Math.round(Number(candidate?.quality_score) || 82), 1, 99),
  };
}

function tokenSet(str) {
  return new Set(
    String(str || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Part 1 Section 8: Detects both temporal overlaps AND semantic topic/takeaway duplicates across a full lecture.
 */
export function dedupeLectureClips(clips, maxCount) {
  const sorted = [...clips].sort((a, b) => (b.rank_score ?? b.quality_score) - (a.rank_score ?? a.quality_score));
  const kept = [];
  for (const c of sorted) {
    const cDur = Math.max(0.5, c.end_seconds - c.start_seconds);
    const cTokens = tokenSet(`${c.title} ${c.topic} ${c.summary} ${c.opening_text}`);
    const isDuplicate = kept.some((k) => {
      const ov = Math.max(0, Math.min(k.end_seconds, c.end_seconds) - Math.max(k.start_seconds, c.start_seconds));
      const kDur = Math.max(0.5, k.end_seconds - k.start_seconds);
      if (ov / Math.min(cDur, kDur) > 0.5) return true;
      const kTokens = tokenSet(`${k.title} ${k.topic} ${k.summary} ${k.opening_text}`);
      if (!cTokens.size || !kTokens.size) return false;
      let inter = 0;
      for (const t of cTokens) if (kTokens.has(t)) inter++;
      return inter / (cTokens.size + kTokens.size - inter) > 0.56;
    });
    if (!isDuplicate) kept.push(c);
    if (kept.length >= maxCount) break;
  }
  return kept.sort((a, b) => a.start_seconds - b.start_seconds);
}

/**
 * Part 1 Sections 1-2: Whole-lecture comprehension & chronological topic segmentation.
 * Handles 30-60 minute lectures seamlessly via overlapping windows & local transcript cache.
 */
async function analyzeLongLecture({ cues, formattedTranscript, transcriptHash, categoryHint, apiCfg, onProgress, callJson }) {
  const cached = loadCachedLectureAnalysis(transcriptHash);
  if (cached && Array.isArray(cached.topics) && cached.topics.length) {
    if (onProgress) onProgress('Loaded cached lecture comprehension & topic map…');
    return {
      main_subject: cached.main_subject || '',
      detected_category: categoryHint && categoryHint !== 'auto' ? categoryHint : cached.detected_category || 'academic_lecture',
      topics: cached.topics,
      fromCache: true,
    };
  }

  const validCatIds = CONTENT_CATEGORIES.filter((c) => c.id !== 'auto').map((c) => c.id);
  const windowSize = 220;
  const overlap = 24;

  // Compact single-call comprehension for shorter lectures (<= 250 cues)
  if (cues.length <= 250) {
    if (onProgress) onProgress('Pass 1/4 — Understanding entire lecture arc & topic structure…');
    try {
      const p1 = await callJson(
        apiCfg,
        `Study this COMPLETE cue-indexed lecture before choosing any clips. Identify its main thesis/subject, content category (${validCatIds.join(' | ')}), and chronological sections (topics, Q&A, stories, explanations, conclusions).
Return JSON ONLY:
{"main_subject":"...","detected_category":"academic_lecture","topics":[{"topic":"...","moment_type":"explanation|story|qa|clarification|conclusion|statement","start_cue":1,"end_cue":24,"summary":"Key takeaway & why standalone"}]}

TRANSCRIPT:
${formattedTranscript}`,
        'You analyze full lectures to map narrative structure, arguments, Q&A, stories, and natural transitions. Return JSON only.',
        onProgress
      );
      const out = {
        main_subject: String(p1?.main_subject || '').trim(),
        detected_category:
          categoryHint && categoryHint !== 'auto'
            ? categoryHint
            : validCatIds.includes(p1?.detected_category)
              ? p1.detected_category
              : 'academic_lecture',
        topics: Array.isArray(p1?.topics) ? p1.topics : [],
      };
      if (out.topics.length) saveCachedLectureAnalysis({ hash: transcriptHash, ...out });
      return out;
    } catch {
      return { main_subject: '', detected_category: categoryHint !== 'auto' ? categoryHint : 'academic_lecture', topics: [] };
    }
  }

  // Long 30-60+ min lecture windowing: process overlapping chunks in parallel pairs cleanly
  const windows = [];
  for (let start = 0; start < cues.length; start += windowSize - overlap) {
    const slice = cues.slice(start, Math.min(cues.length, start + windowSize));
    windows.push({ index: windows.length + 1, cues: slice });
    if (start + windowSize >= cues.length) break;
  }

  if (onProgress) onProgress(`Pass 1/4 — Analyzing full long-form lecture (${windows.length} chronological windows)…`);
  const allTopics = [];
  let mainSubject = '';
  let detectedCat = categoryHint && categoryHint !== 'auto' ? categoryHint : 'academic_lecture';

  for (let i = 0; i < windows.length; i += 2) {
    const batch = windows.slice(i, i + 2);
    const results = await Promise.all(
      batch.map((w) =>
        callJson(
          apiCfg,
          `Analyze part ${w.index}/${windows.length} of a long lecture. Preserve exact cue numbers [idx]. Detect category (${validCatIds.join(' | ')}) and extract distinct arguments, stories, Q&A pairs, and explanations.\nReturn JSON ONLY: {"section_subject":"...","detected_category":"...","topics":[{"topic":"...","moment_type":"explanation|story|qa|clarification|conclusion|statement","start_cue":${w.cues[0].idx},"end_cue":${w.cues[w.cues.length - 1].idx},"summary":"..."}]}\n\nTRANSCRIPT WINDOW:\n${formatCueLines(w.cues)}`,
          'You analyze long-form lecture windows into cohesive topic segments. Return JSON only.',
          onProgress
        ).catch(() => null)
      )
    );
    for (const r of results) {
      if (!r) continue;
      if (!mainSubject && r.section_subject) mainSubject = String(r.section_subject).trim();
      if ((!categoryHint || categoryHint === 'auto') && validCatIds.includes(r.detected_category)) {
        detectedCat = r.detected_category;
      }
      if (Array.isArray(r.topics)) allTopics.push(...r.topics);
    }
  }

  const out = { main_subject: mainSubject, detected_category: detectedCat, topics: allTopics };
  if (out.topics.length) saveCachedLectureAnalysis({ hash: transcriptHash, ...out });
  return out;
}

/**
 * Runs the Hybrid 4-Layer Self-Improving Lecture-to-Reels Pipeline:
 * 1) Full-Lecture Comprehension + Topic Segmentation (with cache & long-form windowing)
 * 2) Memory-Injected Candidate Selection (Effective Global+Category Prefs + Retrieved Past Exemplars/Corrections)
 * 3) Deterministic Boundary Snapping + Independent Critical Criteria Evaluation & Context Repair
 * 4) Semantic Duplicate Filtering + Layer 3 Personalized Ranking
 */
export async function findSmartClips({
  subs = [],
  totalDur = 0,
  apiCfg,
  count = 6,
  minSec = 45,
  maxSec = 135,
  category = 'auto',
  extraPrompt = '',
  onProgress,
  callJson = aiCallJson,
}) {
  const { cues, formattedTranscript, transcriptHash } = prepareCueTranscript(subs);
  if (!cues.length) throw new Error('Generate or import subtitles first so AI can read exact sentence & pause cues.');

  let profile = loadTrainerProfile();
  profile.stats.generated += 1;
  profile = saveTrainerProfile(profile);

  // Periodic meta-reflection when >= 3 new signals accumulated since yesterday (and learning is enabled)
  if (profile.learningEnabled && profile.pendingSignalsSinceReflect >= 3 && profile.lastReflectedDay !== todayKey()) {
    try {
      profile = await runSelfTrainingReflection(apiCfg, onProgress, callJson, category);
    } catch {}
  }

  const maxCount = clamp(Math.round(Number(count) || 6), 1, 25);
  const maxDur = clamp(Math.round(Number(maxSec) || 135), 20, 300);
  const minDur = clamp(Math.round(Number(minSec) || 45), 10, Math.max(15, maxDur - 15));

  // Pass 1: Understand entire lecture + category + topics
  const lecture = await analyzeLongLecture({
    cues,
    formattedTranscript,
    transcriptHash,
    categoryHint: category,
    apiCfg,
    onProgress,
    callJson,
  });
  const activeCategory = lecture.detected_category || 'academic_lecture';
  const effPrefs = getEffectivePreferences(profile, activeCategory);

  // Retrieve Layer 2 compact similarity-matched examples (NEVER sends full raw history)
  const retrieved = retrieveRelevantExamples(profile, {
    category: activeCategory,
    subjectText: `${lecture.main_subject} ${extraPrompt} ${(lecture.topics || []).map((t) => t.topic).join(' ')}`,
    limitPositive: 3,
    limitCorrections: 3,
    limitNegative: 4,
  });

  // Pass 2: Candidate Selection anchored on start_cue/end_cue + Storytelling + Editorial Memory
  if (onProgress) onProgress(`Pass 2/4 — Selecting standalone 60–120s ${activeCategory.replace(/_/g, ' ')} reels…`);

  const targetSweet = clamp(Math.round(effPrefs.preferredDurSec || 85), minDur, maxDur);
  const rulesBlock = [...(profile.learnedRules || []), ...(effPrefs.categoryRules || [])]
    .slice(0, 10)
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n');

  const posBlock = retrieved.positive.length
    ? `\nAPPROVED STYLE EXEMPLARS:\n${retrieved.positive
        .map((x) => `- "${x.title}" (~${x.durSec}s) | Start: "${x.openingText}" | End: "${x.closingText}"`)
        .join('\n')}`
    : '';
  const corrBlock = retrieved.corrections.length
    ? `\nPAST BOUNDARY CORRECTIONS (learn the editorial lesson behind how the user edited AI boundaries):\n${retrieved.corrections
        .map(
          (x) =>
            `- "${x.title}" | AI [${x.aiStartSec}s-${x.aiEndSec}s] -> User [${x.finalStartSec}s-${x.finalEndSec}s] (${x.note})` +
            (x.addedContextText ? ` | User added opening context: "${x.addedContextText}"` : '') +
            (x.trimmedTailText ? ` | User removed unnecessary tail: "${x.trimmedTailText}"` : '')
        )
        .join('\n')}`
    : '';
  const negBlock = retrieved.negative.length
    ? `\nCOMMON REJECTED MISTAKES TO AVOID:\n${retrieved.negative
        .map((x) => `- [${x.reason}] "${x.title}" | Start: "${x.openingText}" | End: "${x.closingText}"`)
        .join('\n')}`
    : '';

  // For massive transcripts (>420 cues), send the rich topic outline + full cue text truncated cleanly per section rather than crashing context limits
  const transcriptForSelection =
    cues.length <= 420
      ? formattedTranscript
      : formatCueLines(cues.slice(0, 420)) +
        `\n... [${cues.length - 420} later cues summarized in topic map above; choose exact start_cue/end_cue inside topic ranges] ...\n` +
        formatCueLines(cues.slice(420, Math.min(cues.length, 680)));

  const p2Prompt = `Select up to ${maxCount} genuinely valuable standalone lecture reels (prioritize QUALITY over quantity: if only 4 strong moments exist, return 4).
Target ~${targetSweet}s (typically 60–120s; acceptable window ${minDur}s–${maxDur}s whenever preserving a complete explanation).

EDITORIAL STANDARDS:
1. Reference EXACT 1-based cue numbers ("start_cue", "end_cue") — NEVER guess decimal timestamps.
2. Natural Beginning: Start at a clear topic intro, question, observation, or explanation start. Never start mid-sentence, with an unexplained pronoun, or with an answer lacking its question.
3. Standalone Context: A viewer who did NOT watch the full lecture must immediately understand what is discussed, why it matters, and the takeaway.
4. Storytelling & Natural Ending: Opening -> Explanation/Story -> Complete Conclusion. Never cut mid-story or before resolution.
${effPrefs.contextLeadPreference >= 0.68 ? '5. Creator Preference: Include introductory setup cues before explanations rather than cutting too late.\n' : ''}${effPrefs.endingTightnessPreference >= 0.68 ? '6. Creator Preference: End cleanly right after the core conclusion without rambling trailing filler.\n' : ''}
${rulesBlock ? `\nLEARNED EDITORIAL RULES:\n${rulesBlock}` : ''}${posBlock}${corrBlock}${negBlock}${extraPrompt ? `\nUSER FOCUS: ${extraPrompt}` : ''}
${lecture.topics.length ? `\nFULL LECTURE MAP (${lecture.main_subject || activeCategory}):\n${lecture.topics.map((t) => `- [${t.start_cue}-${t.end_cue}] (${t.moment_type || 'topic'}) ${t.topic}: ${t.summary || ''}`).join('\n')}` : ''}

Return JSON ONLY:
{"clips":[{"title":"...","topic":"...","moment_type":"explanation|story|qa|clarification|conclusion|statement","start_cue":1,"end_cue":18,"hook_reason":"Why this is a natural opening","ending_reason":"Why the ending resolves cleanly","summary":"Core takeaway","quality_score":88}]}

TRANSCRIPT:
${transcriptForSelection}`;

  const p2 = await callJson(
    apiCfg,
    p2Prompt,
    'You are an experienced documentary and short-form lecture editor prioritizing complete thoughts, natural beginnings/endings, and standalone context. Return valid JSON only.',
    onProgress
  );

  const rawClips = Array.isArray(p2?.clips) ? p2.clips : [];
  let snapped = rawClips
    .map((c, idx) =>
      snapClipBoundaries(
        { ...c, id: `c${idx}_${Date.now()}`, category: activeCategory },
        cues,
        totalDur,
        profile,
        { minSec: minDur, maxSec: maxDur, category: activeCategory }
      )
    )
    .filter(Boolean);

  // Pass 3: Critical Quality Evaluator & Standalone Context Repair
  if (snapped.length) {
    if (onProgress) onProgress('Pass 3/4 — Auditing standalone context, boundaries & critical thresholds…');
    try {
      const inspectPayload = snapped.map((c, i) => ({
        i,
        title: c.title,
        topic: c.topic,
        start_cue: c.start_cue,
        end_cue: c.end_cue,
        durSec: round2(c.end_seconds - c.start_seconds),
        prev2CuesBeforeStart: c.start_cue > 2 ? `${cues[c.start_cue - 3]?.text || ''} | ${c.context_before}` : c.context_before,
        firstCue: c.opening_text,
        lastCue: c.closing_text,
        nextCueAfterEnd: c.context_after,
      }));
      const critic = await callJson(
        apiCfg,
        `Evaluate each candidate clip independently on Critical and High criteria (0–100).
Check whether the clip actually makes standalone sense WITHOUT seeing earlier lecture parts, and whether expanding start_cue/end_cue by 1–4 cues rescues missing setup context or a cut-off conclusion (keep within ${minDur}s–${maxDur}s).
Return JSON ONLY:
{"reviews":[{"i":0,"keep":true,"start_cue":1,"end_cue":18,"hook_grade":"Natural Opening","ending_grade":"Complete Conclusion","critic_note":"Concise editorial note","critical_scores":{"natural_beginning":88,"complete_thought":90,"standalone_context":86,"natural_ending":89,"accuracy_of_meaning":95},"scores":{"educational_value":88,"clarity":90,"storytelling":85,"engagement":82}}]}

CANDIDATES:\n${JSON.stringify(inspectPayload)}`,
        'You are a strict editorial quality gatekeeper. Never let high engagement override incomplete context or broken boundaries. Return JSON only.',
        onProgress
      );

      const revMap = new Map((critic?.reviews || []).map((r) => [Number(r.i), r]));
      const refined = [];
      for (let i = 0; i < snapped.length; i++) {
        const base = snapped[i];
        const r = revMap.get(i);
        if (r && r.keep === false) continue;
        const merged = r
          ? {
              ...base,
              start_cue: Number.isInteger(+r.start_cue) ? +r.start_cue : base.start_cue,
              end_cue: Number.isInteger(+r.end_cue) ? +r.end_cue : base.end_cue,
              hook_grade: r.hook_grade || base.hook_grade,
              ending_grade: r.ending_grade || base.ending_grade,
              critic_note: r.critic_note || base.critic_note,
              critical_scores: r.critical_scores || base.critical_scores,
              scores: r.scores || base.scores,
            }
          : base;

        const reSnapped = snapClipBoundaries(merged, cues, totalDur, profile, {
          minSec: minDur,
          maxSec: maxDur,
          category: activeCategory,
        });
        if (!reSnapped) continue;
        const evalRes = scoreClipWithPersonalizedRanker(reSnapped, profile, activeCategory);
        if (!evalRes.passedCriticalGate) continue; // Enforce critical criterion minimum threshold strictly!
        reSnapped.features = evalRes.features;
        reSnapped.rank_score = evalRes.rankScore;
        reSnapped.quality_score = evalRes.rankScore;
        refined.push(reSnapped);
      }
      if (refined.length) snapped = refined;
    } catch {
      snapped = snapped.map((c) => {
        const evalRes = scoreClipWithPersonalizedRanker(c, profile, activeCategory);
        return { ...c, features: evalRes.features, rank_score: evalRes.rankScore, quality_score: evalRes.rankScore };
      });
    }
  }

  // Pass 4: Semantic + Temporal Deduplication & Personalized Ordering
  if (onProgress) onProgress('Pass 4/4 — Filtering duplicates & ranking by your Editorial Intelligence…');
  const finalClips = dedupeLectureClips(snapped, maxCount).sort((a, b) => (b.rank_score || b.quality_score) - (a.rank_score || a.quality_score));

  recordLectureBatchSummary(transcriptHash, activeCategory, finalClips.length);

  return {
    main_subject: lecture.main_subject,
    detected_category: activeCategory,
    fromCache: !!lecture.fromCache,
    topics: lecture.topics || [],
    clips: finalClips,
    profile: loadTrainerProfile(),
  };
}
