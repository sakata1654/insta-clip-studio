import { aiCallJson } from './prompts.js';

export const TRAINER_STORAGE_KEY = 'icsAiClipTrainerV1';

const CONTINUATION_RE =
  /^(?:and|but|so|or|because|then|which|that|however|also|meanwhile|although|yet|nor|since|while|when|actually|literally|basically|therefore|moreover|furthermore|instead|anyway|still|even|wait|uh|um|و|ثم|لكن|لأن|أو|فإن|بل|اور|لیکن|کیونکہ|تو|پھر|مگر)\b/iu;

const SENTENCE_END_RE = /[.!?؟۔…]["'”’)\]]*$/u;
const CLAUSE_END_RE = /[,،؛:—–-]["'”’)\]]*$/u;
const WEAK_PRONOUN_START_RE = /^(?:he|she|they|it|this|that|these|those|him|her|them|his|their|its)\b/i;

export const REJECT_REASONS = [
  { id: 'mid_thought', label: 'Cut mid-thought' },
  { id: 'weak_hook', label: 'Weak opening hook' },
  { id: 'too_long', label: 'Too long / rambles' },
  { id: 'too_short', label: 'Too short / lacks context' },
  { id: 'off_topic', label: 'Off-topic / boring' },
];

const DEFAULT_RULES = [
  'Open on a clear, intriguing hook or thesis statement — never start on a conjunction ("and", "but", "so") or an unexplained pronoun.',
  'End cleanly after a completed thought, punchline, takeaway, or cadence pause — never cut before the resolution.',
  'Prefer self-contained stories, memorable insights, or emotional/educational peaks that make sense to a viewer with zero prior context.',
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createDefaultProfile() {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    activeDays: [],
    stats: {
      generated: 0,
      approved: 0,
      rejected: 0,
      exported: 0,
      trimCorrected: 0,
      reflections: 0,
    },
    preferences: {
      preferredDurSec: 42,
      startOffsetBiasSec: 0,
      endOffsetBiasSec: 0,
      rejectReasons: {
        mid_thought: 0,
        weak_hook: 0,
        too_long: 0,
        too_short: 0,
        off_topic: 0,
        other: 0,
      },
    },
    learnedRules: [...DEFAULT_RULES],
    positiveExamples: [],
    negativeExamples: [],
    dailyLog: [],
    pendingSignalsSinceReflect: 0,
    lastReflectedAt: null,
    lastReflectedDay: null,
  };
}

export function normalizeTrainerProfile(raw) {
  const base = createDefaultProfile();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    version: 1,
    activeDays: Array.isArray(raw.activeDays) ? raw.activeDays.slice(-90) : [],
    stats: { ...base.stats, ...(raw.stats || {}) },
    preferences: {
      ...base.preferences,
      ...(raw.preferences || {}),
      preferredDurSec: clamp(Number(raw.preferences?.preferredDurSec) || 42, 12, 180),
      startOffsetBiasSec: clamp(Number(raw.preferences?.startOffsetBiasSec) || 0, -2.5, 2.5),
      endOffsetBiasSec: clamp(Number(raw.preferences?.endOffsetBiasSec) || 0, -2.5, 2.5),
      rejectReasons: {
        ...base.preferences.rejectReasons,
        ...(raw.preferences?.rejectReasons || {}),
      },
    },
    learnedRules:
      Array.isArray(raw.learnedRules) && raw.learnedRules.length
        ? raw.learnedRules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 10)
        : [...DEFAULT_RULES],
    positiveExamples: Array.isArray(raw.positiveExamples) ? raw.positiveExamples.slice(-20) : [],
    negativeExamples: Array.isArray(raw.negativeExamples) ? raw.negativeExamples.slice(-20) : [],
    dailyLog: Array.isArray(raw.dailyLog) ? raw.dailyLog.slice(-30) : [],
    pendingSignalsSinceReflect: Math.max(0, Number(raw.pendingSignalsSinceReflect) || 0),
  };
}

export function loadTrainerProfile() {
  try {
    if (typeof localStorage === 'undefined') return createDefaultProfile();
    const raw = localStorage.getItem(TRAINER_STORAGE_KEY);
    if (!raw) return createDefaultProfile();
    return normalizeTrainerProfile(JSON.parse(raw));
  } catch {
    return createDefaultProfile();
  }
}

export function saveTrainerProfile(profile) {
  const norm = normalizeTrainerProfile({ ...profile, updatedAt: new Date().toISOString() });
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TRAINER_STORAGE_KEY, JSON.stringify(norm));
    }
  } catch {}
  return norm;
}

export function resetTrainerProfile() {
  return saveTrainerProfile(createDefaultProfile());
}

export function exportTrainerJson(profile = loadTrainerProfile()) {
  return JSON.stringify(normalizeTrainerProfile(profile), null, 2);
}

export function parseTrainerJson(jsonText) {
  const parsed = JSON.parse(String(jsonText || ''));
  if (!parsed || typeof parsed !== 'object' || (!parsed.stats && !parsed.learnedRules)) {
    throw new Error('Invalid AI Clip Trainer profile JSON.');
  }
  return saveTrainerProfile(parsed);
}

export function getTrainerSummary(profile = loadTrainerProfile()) {
  const s = profile.stats || {};
  const totalJudged = (s.approved || 0) + (s.rejected || 0);
  const approvalRate = totalJudged ? Math.round(((s.approved || 0) / totalJudged) * 100) : null;
  return {
    daysTrained: (profile.activeDays || []).length,
    approved: s.approved || 0,
    rejected: s.rejected || 0,
    exported: s.exported || 0,
    trimCorrected: s.trimCorrected || 0,
    reflections: s.reflections || 0,
    approvalRate,
    preferredDurSec: Math.round(profile.preferences?.preferredDurSec || 42),
    startBiasMs: Math.round((profile.preferences?.startOffsetBiasSec || 0) * 1000),
    endBiasMs: Math.round((profile.preferences?.endOffsetBiasSec || 0) * 1000),
    ruleCount: (profile.learnedRules || []).length,
    pendingSignals: profile.pendingSignalsSinceReflect || 0,
    lastReflectedAt: profile.lastReflectedAt,
  };
}

function touchDailyActivity(profile, kind, note = '') {
  const d = todayKey();
  if (!profile.activeDays.includes(d)) profile.activeDays.push(d);
  let row = profile.dailyLog.find((x) => x.date === d);
  if (!row) {
    row = { date: d, approved: 0, rejected: 0, corrected: 0, note: '' };
    profile.dailyLog.push(row);
  }
  if (kind === 'approve' || kind === 'export') row.approved += 1;
  else if (kind === 'reject') row.rejected += 1;
  else if (kind === 'trim') row.corrected += 1;
  if (note) row.note = String(note).slice(0, 120);
}

function extractClipSnippetFields(clip, cues) {
  let hook = String(clip?.opening_text || '').trim();
  let ending = String(clip?.closing_text || '').trim();
  if ((!hook || !ending) && Array.isArray(cues) && cues.length) {
    const cs = Number(clip?.start_seconds) || 0;
    const ce = Number(clip?.end_seconds) || 0;
    const inside = cues.filter((c) => c.e > cs + 0.05 && c.s < ce - 0.05);
    if (inside.length) {
      if (!hook) hook = inside[0].text;
      if (!ending) ending = inside[inside.length - 1].text;
    }
  }
  return {
    hook: hook.slice(0, 140),
    ending: ending.slice(0, 140),
  };
}

/**
 * Records explicit approval, export success, or rejection with optional reason.
 */
export function recordClipFeedback(clip, action, extra = {}) {
  const profile = loadTrainerProfile();
  const dur = Math.max(1, round2((+clip.end_seconds || 0) - (+clip.start_seconds || 0)));
  const { hook, ending } = extractClipSnippetFields(clip, extra.cues);

  if (action === 'approve' || action === 'export') {
    if (action === 'approve') profile.stats.approved += 1;
    else profile.stats.exported += 1;
    // Update preferred clip duration via EMA
    profile.preferences.preferredDurSec = round2(
      profile.preferences.preferredDurSec * 0.76 + clamp(dur, 12, 180) * 0.24
    );
    const id = clip?.id || `${round2(clip.start_seconds)}-${round2(clip.end_seconds)}`;
    const existingIdx = profile.positiveExamples.findIndex((x) => x.id === id);
    const entry = {
      id,
      title: String(clip?.title || 'Good Clip').slice(0, 80),
      hook,
      ending,
      dur: Math.round(dur),
      score: Math.round(Number(clip?.quality_score) || 85),
      note: String(extra.note || clip?.critic_note || '').slice(0, 140),
      trimDeltaS: round2(extra.trimDeltaS || 0),
      trimDeltaE: round2(extra.trimDeltaE || 0),
      ts: new Date().toISOString(),
    };
    if (existingIdx >= 0) profile.positiveExamples[existingIdx] = { ...profile.positiveExamples[existingIdx], ...entry };
    else profile.positiveExamples.push(entry);
    profile.positiveExamples = profile.positiveExamples.slice(-20);
    profile.pendingSignalsSinceReflect += 1;
    touchDailyActivity(profile, action, entry.title);
  } else if (action === 'reject') {
    profile.stats.rejected += 1;
    const reason = REJECT_REASONS.some((r) => r.id === extra.reason) ? extra.reason : 'other';
    profile.preferences.rejectReasons[reason] = (profile.preferences.rejectReasons[reason] || 0) + 1;
    profile.negativeExamples.push({
      id: clip?.id || `${round2(clip.start_seconds)}-${round2(clip.end_seconds)}`,
      title: String(clip?.title || 'Rejected Clip').slice(0, 80),
      hook,
      ending,
      dur: Math.round(dur),
      reason,
      note: String(extra.note || '').slice(0, 140),
      ts: new Date().toISOString(),
    });
    profile.negativeExamples = profile.negativeExamples.slice(-20);
    profile.pendingSignalsSinceReflect += 1;
    touchDailyActivity(profile, 'reject', `${reason}: ${clip?.title || ''}`);
  }

  return saveTrainerProfile(profile);
}

/**
 * Learns implicitly when a user fine-tunes trimS / trimE after applying an AI clip.
 */
export function recordTrimAdjustment(clip, newStart, newEnd, subs = []) {
  if (!clip || !Number.isFinite(newStart) || !Number.isFinite(newEnd) || newEnd <= newStart) {
    return loadTrainerProfile();
  }
  const origS = Number(clip.start_seconds);
  const origE = Number(clip.end_seconds);
  if (!Number.isFinite(origS) || !Number.isFinite(origE) || origE <= origS) return loadTrainerProfile();

  const deltaS = newStart - origS;
  const deltaE = newEnd - origE;
  const cues = prepareCueTranscript(subs).cues;

  // Record export/approval with new edited boundaries
  let profile = loadTrainerProfile();
  const meaningfulTrim = (Math.abs(deltaS) >= 0.25 && Math.abs(deltaS) <= 15) || (Math.abs(deltaE) >= 0.25 && Math.abs(deltaE) <= 15);
  if (meaningfulTrim) {
    profile.stats.trimCorrected += 1;
    if (Math.abs(deltaS) <= 4.0) {
      profile.preferences.startOffsetBiasSec = round2(
        clamp(profile.preferences.startOffsetBiasSec * 0.78 + deltaS * 0.22, -2.5, 2.5)
      );
    }
    if (Math.abs(deltaE) <= 4.0) {
      profile.preferences.endOffsetBiasSec = round2(
        clamp(profile.preferences.endOffsetBiasSec * 0.78 + deltaE * 0.22, -2.5, 2.5)
      );
    }
    const newDur = Math.max(1, newEnd - newStart);
    profile.preferences.preferredDurSec = round2(
      profile.preferences.preferredDurSec * 0.72 + clamp(newDur, 12, 180) * 0.28
    );
    profile.pendingSignalsSinceReflect += 1;
    touchDailyActivity(profile, 'trim', `Trimmed start ${deltaS >= 0 ? '+' : ''}${round2(deltaS)}s, end ${deltaE >= 0 ? '+' : ''}${round2(deltaE)}s`);
    profile = saveTrainerProfile(profile);
  }

  return recordClipFeedback(
    {
      ...clip,
      start_seconds: newStart,
      end_seconds: newEnd,
      opening_text: '',
      closing_text: '',
    },
    'export',
    { cues, trimDeltaS: deltaS, trimDeltaE: deltaE }
  );
}

/**
 * Self-Training Meta-Learner: Distills concrete natural-language editorial rules
 * from approved, trim-corrected, and rejected clips so future runs improve day by day.
 */
export async function runSelfTrainingReflection(apiCfg, onNote, callJson = aiCallJson) {
  const profile = loadTrainerProfile();
  if (!profile.positiveExamples.length && !profile.negativeExamples.length) {
    return profile;
  }
  if (onNote) onNote('AI Coach distilling your feedback into updated editing rules…');

  const payload = {
    currentRules: profile.learnedRules,
    stats: profile.stats,
    preferredDurationSec: Math.round(profile.preferences.preferredDurSec),
    learnedStartOffsetBiasSec: profile.preferences.startOffsetBiasSec,
    learnedEndOffsetBiasSec: profile.preferences.endOffsetBiasSec,
    rejectReasonCounts: profile.preferences.rejectReasons,
    recentApprovedOrCorrected: profile.positiveExamples.slice(-10),
    recentRejected: profile.negativeExamples.slice(-10),
  };

  const sys = `You are a video editing meta-coach refining a creator's personal short-form clip selection rules.
Inspect the creator's approved clips, manual trim corrections (trimDeltaS/trimDeltaE), and rejected clips with reasons.
Produce 4 to 8 crisp, actionable, non-generic rules tailored to what THIS user actually keeps vs rejects (pacing, hook style, duration, ending completeness, tone).
Return JSON only: {"rules":["rule 1","rule 2"],"focus_note":"One short sentence summarizing what improved today."}`;

  const res = await callJson(
    apiCfg,
    `Update the creator's clip selection rules based on accumulated feedback:\n\n${JSON.stringify(payload)}`,
    sys,
    onNote
  );

  const nextRules = Array.isArray(res?.rules)
    ? res.rules.map((r) => String(r || '').trim()).filter((r) => r.length >= 12).slice(0, 10)
    : [];

  if (nextRules.length >= 2) {
    profile.learnedRules = nextRules;
  }
  profile.stats.reflections += 1;
  profile.pendingSignalsSinceReflect = 0;
  profile.lastReflectedAt = new Date().toISOString();
  profile.lastReflectedDay = todayKey();
  if (res?.focus_note) {
    touchDailyActivity(profile, 'approve', res.focus_note);
  }
  return saveTrainerProfile(profile);
}

/* ---------- Transcript Cue Preparation & Deterministic Boundary Snapping ---------- */

function fmtSec(s) {
  s = Math.max(0, Number(s) || 0);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
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

  const lines = cues.map((c) => {
    const tags = [];
    if (c.gapBeforeMs >= 450) tags.push(`pauseBefore=${c.gapBeforeMs}ms`);
    if (c.gapAfterMs >= 450) tags.push(`pauseAfter=${c.gapAfterMs}ms`);
    if (c.endsSentence) tags.push('sentenceEnd');
    if (c.startsContinuation) tags.push('contStart');
    return `[${c.idx}] (${fmtSec(c.s)}-${fmtSec(c.e)}${tags.length ? ' | ' + tags.join(', ') : ''}) ${c.text}`;
  });

  return { cues, formattedTranscript: lines.join('\n') };
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
 * Resolves start_cue/end_cue (or floats fallback) and deterministically snaps boundaries
 * onto clean silence / sentence edges without exceeding [minSec, maxSec] or clipping words.
 */
export function snapClipBoundaries(candidate, cues, totalDur = 0, profile = createDefaultProfile(), opts = {}) {
  if (!cues.length) return null;
  const minSec = Math.max(8, Number(opts.minSec) || 14);
  const maxSec = Math.max(minSec + 5, Number(opts.maxSec) || 120);
  const maxTotal = totalDur > 0 ? totalDur : cues[cues.length - 1].e + 0.5;

  let si = Number.isInteger(+candidate?.start_cue) ? clamp(+candidate.start_cue - 1, 0, cues.length - 1) : null;
  let ei = Number.isInteger(+candidate?.end_cue) ? clamp(+candidate.end_cue - 1, 0, cues.length - 1) : null;

  if (si === null && Number.isFinite(+candidate?.start_seconds)) {
    si = findNearestCueIndexByTime(cues, +candidate.start_seconds, 'start');
  }
  if (ei === null && Number.isFinite(+candidate?.end_seconds)) {
    ei = findNearestCueIndexByTime(cues, +candidate.end_seconds, 'end');
  }
  if (si === null) si = 0;
  if (ei === null) ei = si;
  if (ei < si) [si, ei] = [ei, si];

  // 1. Clean START boundary: avoid starting mid-clause or on a weak continuation word when a clean edge is adjacent
  const curDur = () => cues[ei].e - cues[si].s;
  const isCleanStart = (idx) => {
    if (idx === 0) return true;
    const c = cues[idx];
    const prev = cues[idx - 1];
    return prev.endsSentence || c.gapBeforeMs >= 420 || !c.startsContinuation;
  };

  if (!isCleanStart(si)) {
    let repaired = false;
    // Try expanding back 1-2 cues to catch the true sentence start
    for (let k = si - 1; k >= Math.max(0, si - 2); k--) {
      if (isCleanStart(k) && cues[ei].e - cues[k].s <= maxSec) {
        si = k;
        repaired = true;
        break;
      }
    }
    // Otherwise step forward 1 cue if it still leaves enough duration
    if (!repaired && si + 1 <= ei && isCleanStart(si + 1) && cues[ei].e - cues[si + 1].s >= minSec) {
      si = si + 1;
    }
  }

  // 2. Clean END boundary: ensure we finish a sentence or hit a natural pause
  const isCleanEnd = (idx) => {
    if (idx >= cues.length - 1) return true;
    const c = cues[idx];
    return c.endsSentence || c.gapAfterMs >= 480;
  };

  if (!isCleanEnd(ei)) {
    let repaired = false;
    // Try expanding forward up to 3 cues to reach the completed thought
    for (let k = ei + 1; k <= Math.min(cues.length - 1, ei + 3); k++) {
      if (isCleanEnd(k) && cues[k].e - cues[si].s <= maxSec) {
        ei = k;
        repaired = true;
        break;
      }
    }
    // Or trim back 1-2 cues if previous cue ended cleanly and duration stays valid
    if (!repaired) {
      for (let k = ei - 1; k >= Math.max(si, ei - 2); k--) {
        if (isCleanEnd(k) && cues[k].e - cues[si].s >= minSec) {
          ei = k;
          break;
        }
      }
    }
  }

  // Ensure duration is at least minSec if transcript permits
  while (curDur() < minSec && ei < cues.length - 1) {
    if (cues[ei + 1].e - cues[si].s > maxSec) break;
    ei += 1;
    if (isCleanEnd(ei) && curDur() >= minSec) break;
  }

  // Ensure duration does not exceed maxSec by trimming cleanly from end onto nearest sentence/pause
  while (curDur() > maxSec && ei > si) {
    ei -= 1;
  }

  const startCue = cues[si];
  const endCue = cues[ei];
  const startBias = clamp(Number(profile?.preferences?.startOffsetBiasSec) || 0, -0.5, 0.5);
  const endBias = clamp(Number(profile?.preferences?.endOffsetBiasSec) || 0, -0.5, 0.5);

  // Breathable padding capped strictly inside adjacent gaps so nearby words never bleed in
  const maxPre = si === 0 ? Math.min(0.45, startCue.s) : Math.max(0.02, (startCue.gapBeforeMs / 1000) * 0.6);
  const prePad = clamp(0.16 - startBias, 0.02, Math.min(0.48, maxPre));
  const maxPost =
    ei === cues.length - 1
      ? Math.min(0.65, Math.max(0.1, maxTotal - endCue.e))
      : Math.max(0.04, (endCue.gapAfterMs / 1000) * 0.65);
  const postPad = clamp(0.24 + endBias, 0.04, Math.min(0.65, maxPost));

  const start_seconds = round2(Math.max(0, startCue.s - prePad));
  const end_seconds = round2(Math.min(maxTotal, Math.max(start_seconds + 0.5, endCue.e + postPad)));

  const startClean = isCleanStart(si) && !WEAK_PRONOUN_START_RE.test(startCue.text);
  const endClean = isCleanEnd(ei);

  return {
    id: candidate?.id || `clip_${startCue.idx}_${endCue.idx}`,
    title: String(candidate?.title || 'Untitled Clip').trim(),
    summary: String(candidate?.summary || candidate?.hook_reason || '').trim(),
    hook_reason: String(candidate?.hook_reason || '').trim(),
    ending_reason: String(candidate?.ending_reason || '').trim(),
    critic_note: String(candidate?.critic_note || '').trim(),
    hook_grade: String(candidate?.hook_grade || (startClean ? 'Clean Hook' : 'Check Start')).trim(),
    ending_grade: String(candidate?.ending_grade || (endClean ? 'Complete' : 'Open Tail')).trim(),
    start_cue: startCue.idx,
    end_cue: endCue.idx,
    start_seconds,
    end_seconds,
    opening_text: startCue.text,
    closing_text: endCue.text,
    context_before: si > 0 ? cues[si - 1].text : '',
    context_after: ei < cues.length - 1 ? cues[ei + 1].text : '',
    boundary_clean: startClean && endClean,
    quality_score: clamp(Math.round(Number(candidate?.quality_score) || 82), 1, 99),
  };
}

function dedupeOverlappingClips(clips, maxCount) {
  const sorted = [...clips].sort((a, b) => b.quality_score - a.quality_score);
  const kept = [];
  for (const c of sorted) {
    const cDur = Math.max(0.5, c.end_seconds - c.start_seconds);
    const overlaps = kept.some((k) => {
      const ov = Math.max(0, Math.min(k.end_seconds, c.end_seconds) - Math.max(k.start_seconds, c.start_seconds));
      const kDur = Math.max(0.5, k.end_seconds - k.start_seconds);
      return ov / Math.min(cDur, kDur) > 0.6;
    });
    if (!overlaps) kept.push(c);
    if (kept.length >= maxCount) break;
  }
  return kept.sort((a, b) => a.start_seconds - b.start_seconds);
}

/**
 * Multi-Pass Self-Trained Smart Clip Finder:
 * 1) Narrative Topic Map (cue-indexed)
 * 2) Memory-Injected Candidate Selection using start_cue & end_cue
 * 3) Deterministic Pause/Punctuation Snapping + AI Boundary Critic Pass
 * 4) Automatic daily self-reflection when sufficient new signals have accumulated
 */
export async function findSmartClips({
  subs = [],
  totalDur = 0,
  apiCfg,
  count = 6,
  minSec = 15,
  maxSec = 120,
  extraPrompt = '',
  onProgress,
  callJson = aiCallJson,
}) {
  const { cues, formattedTranscript } = prepareCueTranscript(subs);
  if (!cues.length) throw new Error('Generate or import subtitles first so AI can read exact sentence & pause cues.');

  let profile = loadTrainerProfile();
  profile.stats.generated += 1;
  profile = saveTrainerProfile(profile);

  // Auto-run daily meta-reflection if >=3 new signals accumulated since yesterday
  if (profile.pendingSignalsSinceReflect >= 3 && profile.lastReflectedDay !== todayKey()) {
    try {
      profile = await runSelfTrainingReflection(apiCfg, onProgress, callJson);
    } catch {
      // Never block clip discovery if reflection fails
    }
  }

  const maxCount = clamp(Math.round(Number(count) || 6), 1, 25);
  const maxDur = clamp(Math.round(Number(maxSec) || 120), 15, 300);
  const minDur = clamp(Math.round(Number(minSec) || 15), 8, Math.max(12, maxDur - 5));

  // Pass 1: Topic / Arc Map (only if transcript is rich enough to benefit)
  let topics = [];
  if (cues.length >= 10) {
    if (onProgress) onProgress('Pass 1/3 — Mapping narrative arcs & topic shifts…');
    try {
      const p1 = await callJson(
        apiCfg,
        `Analyze this cue-indexed transcript and outline the main chronological sections/ideas.\nReturn JSON: {"topics":[{"topic":"...","start_cue":1,"end_cue":12,"summary":"..."}]}.\n\nTRANSCRIPT:\n${formattedTranscript}`,
        'You analyze long-form audio/video transcripts into clear semantic chapters. Return JSON only.',
        onProgress
      );
      topics = Array.isArray(p1?.topics) ? p1.topics : [];
    } catch {
      topics = [];
    }
  }

  // Pass 2: Candidate Selection anchored on start_cue & end_cue + Self-Trained Profile
  if (onProgress) onProgress('Pass 2/3 — Selecting standalone clips using learned rules…');
  const posBlock = profile.positiveExamples.length
    ? `\nEXAMPLES THIS CREATOR LOVED & KEPT (match this energy, hook quality, and clean endings):\n` +
      profile.positiveExamples
        .slice(-5)
        .map((x) => `- "${x.title}" (~${x.dur}s) | Hook: "${x.hook}" | Ending: "${x.ending}"`)
        .join('\n')
    : '';
  const negBlock = profile.negativeExamples.length
    ? `\nMISTAKES TO AVOID (rejected previously by this creator):\n` +
      profile.negativeExamples
        .slice(-5)
        .map((x) => `- [${x.reason}] "${x.title}" | Hook: "${x.hook}" | Ending: "${x.ending}"`)
        .join('\n')
    : '';

  const p2Prompt = `Select up to ${maxCount} high-retention standalone short clips (${minDur}s to ${maxDur}s; creator's learned sweet spot is ~${Math.round(profile.preferences.preferredDurSec)}s).

CRITICAL BOUNDARY RULES:
1. Reference EXACT 1-based cue numbers ("start_cue", "end_cue") from the [idx] tags — NEVER invent decimal timestamps.
2. Opening rule: Choose a start_cue that has "pauseBefore" or follows "sentenceEnd" and opens directly on a strong hook/topic — NEVER start on a continuation conjunction or dangling pronoun ("he", "it", "they") unless immediately clarified in the same cue.
3. Closing rule: Choose an end_cue that has "sentenceEnd" and resolves the thought cleanly — NEVER cut right before a punchline or explanation.
${profile.learnedRules.length ? `\nCREATOR'S SELF-TRAINED RULES:\n${profile.learnedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}${posBlock}${negBlock}${extraPrompt ? `\nUSER FOCUS REQUEST: ${extraPrompt}` : ''}
${topics.length ? `\nTOPIC OUTLINE:\n${topics.map((t) => `- Cues [${t.start_cue}-${t.end_cue}] ${t.topic}: ${t.summary || ''}`).join('\n')}` : ''}

Return JSON ONLY:
{"clips":[{"title":"Punchy Title","start_cue":1,"end_cue":12,"hook_reason":"Why this first cue hooks immediately","ending_reason":"Why this last cue resolves cleanly","summary":"1-sentence takeaway","quality_score":90}]}

CUE-INDEXED TRANSCRIPT:
${formattedTranscript}`;

  const p2 = await callJson(
    apiCfg,
    p2Prompt,
    'You are an elite short-form video editor and retention strategist. Return valid JSON only.',
    onProgress
  );

  const rawClips = Array.isArray(p2?.clips) ? p2.clips : [];
  let snapped = rawClips
    .map((c, idx) => snapClipBoundaries({ ...c, id: `c${idx}_${Date.now()}` }, cues, totalDur, profile, { minSec: minDur, maxSec: maxDur }))
    .filter(Boolean);

  // Pass 3: AI Boundary Critic & Refiner (checks actual prev/first/last/next cue lines!)
  if (snapped.length) {
    if (onProgress) onProgress('Pass 3/3 — Critic reviewing hooks, endings & cue boundaries…');
    try {
      const inspectPayload = snapped.map((c, i) => ({
        i,
        title: c.title,
        start_cue: c.start_cue,
        end_cue: c.end_cue,
        durSec: round2(c.end_seconds - c.start_seconds),
        prevCueBeforeStart: c.context_before,
        firstCue: c.opening_text,
        lastCue: c.closing_text,
        nextCueAfterEnd: c.context_after,
      }));
      const critic = await callJson(
        apiCfg,
        `Audit each candidate clip's ACTUAL start/end boundaries against its surrounding cues (prevCueBeforeStart / nextCueAfterEnd).
If a clip cuts mid-thought or misses an essential setup/punchline 1-2 cues nearby, adjust "start_cue" or "end_cue" (while keeping duration between ${minDur}s and ${maxDur}s). Drop nothing unless truly unsalvageable ("keep": false).
Return JSON ONLY: {"reviews":[{"i":0,"keep":true,"start_cue":1,"end_cue":12,"hook_grade":"Strong Hook","ending_grade":"Complete","quality_score":92,"critic_note":"Concise reason"}]}

CANDIDATES:\n${JSON.stringify(inspectPayload)}`,
        'You are a ruthless short-form editing director checking cut points word-for-word. Return JSON only.',
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
              quality_score: Number.isFinite(+r.quality_score) ? +r.quality_score : base.quality_score,
              critic_note: r.critic_note || base.critic_note,
            }
          : base;
        const reSnapped = snapClipBoundaries(merged, cues, totalDur, profile, { minSec: minDur, maxSec: maxDur });
        if (reSnapped) refined.push(reSnapped);
      }
      if (refined.length) snapped = refined;
    } catch {
      // Keep deterministically snapped clips if critic fails
    }
  }

  return {
    topics,
    clips: dedupeOverlappingClips(snapped, maxCount),
    profile,
  };
}
