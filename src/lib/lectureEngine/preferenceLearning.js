import { aiCallJson } from '../prompts.js';
import {
  APPROVE_TAGS,
  DEFAULT_RANKING_WEIGHTS,
  INTERACTION_WEIGHTS,
  REJECT_REASONS,
  createCategoryPref,
  loadTrainerProfile,
  normalizeReasonId,
  saveTrainerProfile,
  todayKey,
} from './lectureStorage.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function getEffectivePreferences(profile = loadTrainerProfile(), category = 'general') {
  const g = profile.globalPreferences;
  const c = category && category !== 'auto' ? profile.categoryProfiles?.[category] : null;
  if (!c || !c.samples) {
    return {
      category: 'global',
      preferredDurSec: g.preferredDurSec.value,
      contextLeadPreference: g.contextLeadPreference.value,
      endingTightnessPreference: g.endingTightnessPreference.value,
      startOffsetBiasSec: g.startOffsetBiasSec.value,
      endOffsetBiasSec: g.endOffsetBiasSec.value,
      confidence: g.preferredDurSec.confidence,
      categorySamples: 0,
      approveTags: g.approveTags,
      rejectReasons: g.rejectReasons,
      categoryRules: [],
    };
  }
  // Smooth blend: category profile grows influence up to 75% as category samples reach 8+, avoiding overlearning on 1 lecture
  const catWeight = clamp((c.samples / 8) * 0.75, 0.15, 0.75);
  const blend = (gv, cv) => round2(gv * (1 - catWeight) + cv * catWeight);
  return {
    category,
    preferredDurSec: Math.round(blend(g.preferredDurSec.value, c.preferredDurSec.value)),
    contextLeadPreference: blend(g.contextLeadPreference.value, c.contextLeadPreference.value),
    endingTightnessPreference: blend(g.endingTightnessPreference.value, c.endingTightnessPreference.value),
    startOffsetBiasSec: blend(g.startOffsetBiasSec.value, c.startOffsetBiasSec.value),
    endOffsetBiasSec: blend(g.endOffsetBiasSec.value, c.endOffsetBiasSec.value),
    confidence: round2(Math.max(g.preferredDurSec.confidence, c.preferredDurSec.confidence)),
    categorySamples: c.samples,
    approveTags: c.approveTags,
    rejectReasons: c.rejectReasons,
    categoryRules: c.learnedRules || [],
  };
}

function updateStatPref(statObj, observation, signalWeight, baseAlpha, minV, maxV) {
  const prevCount = statObj.count || 0;
  // Adaptive learning rate decreases smoothly as confidence matures so single outliers don't overwrite steady habits
  const effAlpha = clamp((baseAlpha * signalWeight) / (1 + prevCount * 0.08), 0.05, 0.28);
  const nextVal = clamp(round2(statObj.value * (1 - effAlpha) + observation * effAlpha), minV, maxV);
  const nextCount = prevCount + 1;
  return {
    value: nextVal,
    confidence: clamp(round2(1 - Math.exp(-nextCount / 4.5)), 0, 1),
    count: nextCount,
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
  else if (kind === 'manual_correction' || kind === 'trim') row.corrected += 1;
  if (note) row.note = String(note).slice(0, 140);
}

/**
 * Extracts normalized [0..1] feature vector used by Layer 3 PersonalizedRanker.
 */
export function extractClipFeatures(clip = {}, effPrefs = null) {
  const cs = clip.critical_scores || {};
  const scores = clip.scores || {};
  const dur = Math.max(1, (+clip.end_seconds || 0) - (+clip.start_seconds || 0));
  const targetDur = effPrefs?.preferredDurSec || 85;
  const durErr = Math.abs(dur - targetDur) / Math.max(30, targetDur);
  const leadPref = effPrefs?.contextLeadPreference ?? 0.55;
  const hasContextLead = clip.context_expanded || (clip.context_before && !clip.starts_continuation) ? 1 : 0.45;

  return {
    naturalBeginning: clamp((Number(cs.natural_beginning ?? 80)) / 100, 0, 1),
    completeThought: clamp((Number(cs.complete_thought ?? 82)) / 100, 0, 1),
    standaloneContext: clamp((Number(cs.standalone_context ?? 80)) / 100, 0, 1),
    naturalEnding: clamp((Number(cs.natural_ending ?? 80)) / 100, 0, 1),
    storytelling: clamp((Number(scores.storytelling ?? clip.quality_score ?? 80)) / 100, 0, 1),
    educationalValue: clamp((Number(scores.educational_value ?? clip.quality_score ?? 80)) / 100, 0, 1),
    engagement: clamp((Number(scores.engagement ?? clip.quality_score ?? 80)) / 100, 0, 1),
    durationFit: clamp(1 - durErr * 0.65, 0.1, 1),
    pauseCleanliness: clip.boundary_clean ? 1 : 0.45,
    contextLeadMatch: leadPref > 0.6 ? hasContextLead : 0.7,
  };
}

/**
 * Layer 3 Personalized Ranker: scores a candidate using adaptive feature weights
 * while preserving hard critical gates (incomplete thoughts can never win via engagement).
 */
export function scoreClipWithPersonalizedRanker(clip, profile = loadTrainerProfile(), category = 'general') {
  const effPrefs = getEffectivePreferences(profile, category);
  const feat = extractClipFeatures(clip, effPrefs);
  const weights = profile.rankingWeights || DEFAULT_RANKING_WEIGHTS;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [k, v] of Object.entries(feat)) {
    const w = Number(weights[k] ?? 1);
    weightedSum += v * w;
    totalWeight += w;
  }
  const rankScore = clamp(Math.round((weightedSum / Math.max(0.1, totalWeight)) * 100), 1, 99);

  // Critical criteria minimum gate (Section 7): critical dimensions cannot be compensated by engagement
  const cs = clip.critical_scores || {};
  const criticalChecks = [
    ['natural_beginning', cs.natural_beginning ?? 80, 68],
    ['complete_thought', cs.complete_thought ?? 82, 70],
    ['standalone_context', cs.standalone_context ?? 80, 68],
    ['natural_ending', cs.natural_ending ?? 80, 68],
    ['accuracy_of_meaning', cs.accuracy_of_meaning ?? 85, 75],
  ];
  const failedCritical = criticalChecks.filter(([, val, min]) => Number(val) < min).map(([name]) => name);

  return {
    features: feat,
    rankScore,
    passedCriticalGate: failedCritical.length === 0,
    failedCritical,
  };
}

function updateRankingWeightsOnline(profile, features, isPositive, signalWeight) {
  if (!features || typeof features !== 'object') return;
  const lr = clamp(0.06 * signalWeight, 0.01, 0.12);
  const rw = { ...(profile.rankingWeights || DEFAULT_RANKING_WEIGHTS) };
  for (const k of Object.keys(DEFAULT_RANKING_WEIGHTS)) {
    const fv = Number(features[k]);
    if (!Number.isFinite(fv)) continue;
    // Center around 0.72 baseline: boost features strongly present in approved/corrected clips, penalize features correlated with rejections
    const delta = (fv - 0.72) * (isPositive ? 1 : -1) * lr;
    rw[k] = clamp(round2((rw[k] || 1) + delta), 0.35, 2.6);
  }
  profile.rankingWeights = rw;
}

function extractClipSnippetFields(clip, cues) {
  let hook = String(clip?.opening_text || '').trim();
  let ending = String(clip?.closing_text || '').trim();
  let fullExcerpt = '';
  if (Array.isArray(cues) && cues.length) {
    const cs = Number(clip?.start_seconds) || 0;
    const ce = Number(clip?.end_seconds) || 0;
    const inside = cues.filter((c) => c.e > cs + 0.05 && c.s < ce - 0.05);
    if (inside.length) {
      if (!hook) hook = inside[0].text;
      if (!ending) ending = inside[inside.length - 1].text;
      fullExcerpt = inside.map((x) => x.text).join(' ').slice(0, 420);
    }
  }
  return {
    hook: hook.slice(0, 160),
    ending: ending.slice(0, 160),
    fullExcerpt: fullExcerpt || `${hook} ... ${ending}`.trim(),
  };
}

function applyDecisionToPrefTarget(target, action, dur, reasonId, positiveTags, deltaS, deltaE, weight) {
  target.samples = (target.samples || 0) + 1;
  if (action === 'approve' || action === 'export' || action === 'manual_correction') {
    target.preferredDurSec = updateStatPref(target.preferredDurSec, clamp(dur, 18, 180), weight, 0.22, 20, 180);
    for (const tag of positiveTags || []) {
      if (APPROVE_TAGS.some((t) => t.id === tag)) {
        target.approveTags[tag] = (target.approveTags[tag] || 0) + 1;
      }
    }
    if (action === 'manual_correction') {
      if (Math.abs(deltaS) <= 25) {
        target.startOffsetBiasSec = updateStatPref(target.startOffsetBiasSec, clamp(deltaS, -6, 6), weight, 0.25, -4, 4);
      }
      if (Math.abs(deltaE) <= 25) {
        target.endOffsetBiasSec = updateStatPref(target.endOffsetBiasSec, clamp(deltaE, -6, 6), weight, 0.25, -4, 4);
      }
      if (deltaS <= -1.2) {
        target.contextLeadPreference = updateStatPref(target.contextLeadPreference, 0.92, weight, 0.24, 0, 1);
      } else if (deltaS >= 1.2) {
        target.contextLeadPreference = updateStatPref(target.contextLeadPreference, 0.25, weight, 0.2, 0, 1);
      }
      if (deltaE <= -1.2) {
        target.endingTightnessPreference = updateStatPref(target.endingTightnessPreference, 0.88, weight, 0.24, 0, 1);
      } else if (deltaE >= 1.2) {
        target.endingTightnessPreference = updateStatPref(target.endingTightnessPreference, 0.3, weight, 0.18, 0, 1);
      }
    }
  } else if (action === 'reject') {
    target.rejectReasons[reasonId] = (target.rejectReasons[reasonId] || 0) + 1;
    if (reasonId === 'starts_too_late' || reasonId === 'missing_context') {
      target.contextLeadPreference = updateStatPref(target.contextLeadPreference, 0.88, weight, 0.18, 0, 1);
    } else if (reasonId === 'starts_too_early') {
      target.contextLeadPreference = updateStatPref(target.contextLeadPreference, 0.25, weight, 0.18, 0, 1);
    } else if (reasonId === 'too_long' || reasonId === 'poor_pacing') {
      target.preferredDurSec = updateStatPref(target.preferredDurSec, Math.max(30, target.preferredDurSec.value - 15), weight, 0.15, 20, 180);
    } else if (reasonId === 'too_short' || reasonId === 'incomplete_explanation') {
      target.preferredDurSec = updateStatPref(target.preferredDurSec, Math.min(130, target.preferredDurSec.value + 15), weight, 0.15, 20, 180);
    }
  }
}

/**
 * Records any weighted user editing signal ('preview_open' | 'approve' | 'reject' | 'manual_correction' | 'export').
 */
export function recordClipFeedback(clip, action = 'approve', extra = {}) {
  const profile = loadTrainerProfile();
  if (!profile.learningEnabled) return profile;

  const category = clip?.category && clip.category !== 'auto' ? clip.category : extra.category || 'general';
  const weight = INTERACTION_WEIGHTS[action] || 0.7;
  const dur = Math.max(1, round2((+clip.end_seconds || 0) - (+clip.start_seconds || 0)));
  const { hook, ending, fullExcerpt } = extractClipSnippetFields(clip, extra.cues);
  const features = clip?.features || extractClipFeatures(clip, getEffectivePreferences(profile, category));
  const reasonId = normalizeReasonId(extra.reason);
  const positiveTags = Array.isArray(extra.positiveTags) ? extra.positiveTags : [];
  const deltaS = round2(extra.trimDeltaS || 0);
  const deltaE = round2(extra.trimDeltaE || 0);

  if (action === 'preview_open') {
    profile.stats.previewed = (profile.stats.previewed || 0) + 1;
    // Passive weak signal — updates count only, avoids overreacting to browsing
    return saveTrainerProfile(profile);
  }

  if (action === 'approve') {
    profile.stats.approved += 1;
    profile.stats.reviewed += 1;
  } else if (action === 'export') {
    profile.stats.exported += 1;
    if (!clip?._alreadyReviewed) profile.stats.reviewed += 1;
  } else if (action === 'manual_correction') {
    profile.stats.trimCorrected += 1;
    profile.stats.reviewed += 1;
    if (deltaS <= -0.8) profile.stats.extendedBeginningCount = (profile.stats.extendedBeginningCount || 0) + 1;
    if (deltaE <= -0.8) profile.stats.shortenedEndingCount = (profile.stats.shortenedEndingCount || 0) + 1;
    const tc = profile.stats.trimCorrected;
    profile.stats.avgDeltaStartSec = round2(((profile.stats.avgDeltaStartSec || 0) * (tc - 1) + deltaS) / tc);
    profile.stats.avgDeltaEndSec = round2(((profile.stats.avgDeltaEndSec || 0) * (tc - 1) + deltaE) / tc);
  } else if (action === 'reject') {
    profile.stats.rejected += 1;
    profile.stats.reviewed += 1;
  }

  // Update Global + Category-specific preference vectors
  applyDecisionToPrefTarget(profile.globalPreferences, action, dur, reasonId, positiveTags, deltaS, deltaE, weight);
  if (category && category !== 'general') {
    if (!profile.categoryProfiles[category]) profile.categoryProfiles[category] = createCategoryPref(category);
    applyDecisionToPrefTarget(profile.categoryProfiles[category], action, dur, reasonId, positiveTags, deltaS, deltaE, weight);
  }

  // Update Layer 3 Personalized Ranking weights
  updateRankingWeightsOnline(profile, features, action !== 'reject', weight);

  // Store Layer 2 rich exemplar (prioritizing non-redundant distinct examples)
  const id = clip?.id || `${round2(clip.start_seconds)}-${round2(clip.end_seconds)}`;
  const existingIdx = profile.examples.findIndex((x) => x.id === id);
  const entry = {
    id,
    decision: action,
    weight,
    category,
    title: String(clip?.title || 'Clip').slice(0, 90),
    topic: String(clip?.topic || '').slice(0, 80),
    momentType: String(clip?.moment_type || 'explanation'),
    openingText: hook,
    closingText: ending,
    fullExcerpt,
    aiStartSec: round2(extra.origStartSec ?? clip?.start_seconds),
    aiEndSec: round2(extra.origEndSec ?? clip?.end_seconds),
    finalStartSec: round2(clip?.start_seconds),
    finalEndSec: round2(clip?.end_seconds),
    durSec: Math.round(dur),
    deltaS,
    deltaE,
    addedContextText: String(extra.addedContextText || '').slice(0, 180),
    trimmedTailText: String(extra.trimmedTailText || '').slice(0, 180),
    reason: action === 'reject' ? reasonId : undefined,
    positiveTags,
    note: String(extra.note || clip?.critic_note || '').slice(0, 160),
    features,
    criticalScores: clip?.critical_scores || null,
    ts: new Date().toISOString(),
  };
  if (existingIdx >= 0) profile.examples[existingIdx] = { ...profile.examples[existingIdx], ...entry };
  else profile.examples.push(entry);
  profile.examples = profile.examples.slice(-60);

  profile.pendingSignalsSinceReflect += 1;
  profile.profileVersion = (profile.profileVersion || 1) + (action === 'manual_correction' ? 1 : 0);
  touchDailyActivity(profile, action, action === 'reject' ? `${reasonId}: ${entry.title}` : entry.title);

  return saveTrainerProfile(profile);
}

/**
 * Learns high-precision boundary lessons whenever a user adjusts trimS/trimE (or merges/splits) on an AI suggestion.
 */
export function recordTrimAdjustment(clip, newStart, newEnd, subs = []) {
  const profile = loadTrainerProfile();
  if (!profile.learningEnabled) return profile;
  if (!clip || !Number.isFinite(newStart) || !Number.isFinite(newEnd) || newEnd <= newStart) return profile;

  const origS = Number(clip.start_seconds);
  const origE = Number(clip.end_seconds);
  if (!Number.isFinite(origS) || !Number.isFinite(origE) || origE <= origS) return profile;

  const deltaS = newStart - origS;
  const deltaE = newEnd - origE;
  const meaningfulTrim =
    (Math.abs(deltaS) >= 0.4 && Math.abs(deltaS) <= 45) || (Math.abs(deltaE) >= 0.4 && Math.abs(deltaE) <= 45);

  const sortedCues = [...(subs || [])]
    .filter((x) => Number.isFinite(+x?.s) && Number.isFinite(+x?.e))
    .sort((a, b) => +a.s - +b.s)
    .map((x) => ({ s: +x.s, e: +x.e, text: String(x.orig ?? x.t ?? '').trim() }));

  let addedContextText = '';
  if (deltaS <= -0.8 && sortedCues.length) {
    addedContextText = sortedCues
      .filter((c) => c.e > newStart && c.s < origS)
      .map((c) => c.text)
      .join(' ');
  }
  let trimmedTailText = '';
  if (deltaE <= -0.8 && sortedCues.length) {
    trimmedTailText = sortedCues
      .filter((c) => c.e > newEnd && c.s < origE)
      .map((c) => c.text)
      .join(' ');
  }

  if (meaningfulTrim) {
    recordClipFeedback(
      { ...clip, start_seconds: newStart, end_seconds: newEnd, opening_text: '', closing_text: '' },
      'manual_correction',
      {
        cues: sortedCues,
        origStartSec: origS,
        origEndSec: origE,
        trimDeltaS: deltaS,
        trimDeltaE: deltaE,
        addedContextText,
        trimmedTailText,
        note:
          deltaS <= -1.2
            ? `Extended beginning ${Math.abs(round2(deltaS))}s earlier for setup context`
            : deltaE <= -1.2
              ? `Trimmed tail ${Math.abs(round2(deltaE))}s earlier for cleaner ending`
              : 'Adjusted clip timing',
      }
    );
  }

  return recordClipFeedback(
    { ...clip, start_seconds: newStart, end_seconds: newEnd, opening_text: '', closing_text: '', _alreadyReviewed: meaningfulTrim },
    'export',
    { cues: sortedCues, trimDeltaS: deltaS, trimDeltaE: deltaE }
  );
}

/**
 * Derives clear, strictly evidence-grounded human-readable editorial preference statements
 * solely from stored decisions, averages, and confidences (zero fabricated metrics).
 */
export function describeLearnedPreferences(profile = loadTrainerProfile()) {
  const g = profile.globalPreferences;
  const s = profile.stats || {};
  const lines = [];

  if (g.preferredDurSec.count >= 2) {
    const conf = g.preferredDurSec.confidence >= 0.65 ? 'strong' : g.preferredDurSec.confidence >= 0.35 ? 'moderate' : 'early';
    lines.push({
      id: 'dur_pref',
      text: `Targets ~${Math.round(g.preferredDurSec.value)}s reel pacing (${conf} confidence across ${g.preferredDurSec.count} decisions).`,
      confidence: g.preferredDurSec.confidence,
    });
  }
  if ((s.extendedBeginningCount || 0) >= 2 || g.contextLeadPreference.value >= 0.68) {
    lines.push({
      id: 'lead_ctx',
      text: `Prefers including extra introductory context before explanations (${s.extendedBeginningCount || 0} start extensions, avg ${s.avgDeltaStartSec || 0}s).`,
      confidence: g.contextLeadPreference.confidence,
    });
  }
  if ((s.shortenedEndingCount || 0) >= 2 || g.endingTightnessPreference.value >= 0.68) {
    lines.push({
      id: 'end_tight',
      text: `Prefers tight endings immediately at thought completion (${s.shortenedEndingCount || 0} tail trims, avg ${s.avgDeltaEndSec || 0}s).`,
      confidence: g.endingTightnessPreference.confidence,
    });
  }

  const topRej = Object.entries(g.rejectReasons || {})
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  for (const [rid, cnt] of topRej) {
    const lbl = REJECT_REASONS.find((r) => r.id === rid)?.label || rid;
    lines.push({
      id: `rej_${rid}`,
      text: `Actively guards against "${lbl}" (flagged ${cnt} times).`,
      confidence: clamp(1 - Math.exp(-cnt / 4), 0.2, 0.95),
    });
  }

  const topPos = Object.entries(g.approveTags || {})
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  for (const [tid, cnt] of topPos) {
    const lbl = APPROVE_TAGS.find((t) => t.id === tid)?.label || tid;
    lines.push({
      id: `pos_${tid}`,
      text: `Prioritizes clips with "${lbl}" (${cnt} positive tags).`,
      confidence: clamp(1 - Math.exp(-cnt / 4), 0.2, 0.95),
    });
  }

  const catKeys = Object.entries(profile.categoryProfiles || {}).filter(([, c]) => (c.samples || 0) >= 2);
  for (const [cid, cp] of catKeys) {
    lines.push({
      id: `cat_${cid}`,
      text: `${cid.replace(/_/g, ' ')}: adapted sweet spot ~${Math.round(cp.preferredDurSec.value)}s (${cp.samples} category reviews).`,
      confidence: cp.preferredDurSec.confidence,
    });
  }

  const disabled = new Set(profile.disabledPreferences || []);
  return lines.filter((l) => !disabled.has(l.id));
}

/**
 * Self-Training Meta-Learner: asks AI to synthesize concise natural-language editing rules
 * from accumulated global + category feedback (never overwrites user-disabled instincts).
 */
export async function runSelfTrainingReflection(apiCfg, onNote, callJson = aiCallJson, category = 'general') {
  const profile = loadTrainerProfile();
  if (!profile.learningEnabled) return profile;
  if (!profile.examples.length) return profile;

  if (onNote) onNote('Distilling feedback patterns into updated editorial rules…');

  const recentPos = profile.examples.filter((x) => x.decision !== 'reject').slice(-8);
  const recentNeg = profile.examples.filter((x) => x.decision === 'reject').slice(-8);

  const payload = {
    focusCategory: category,
    currentRules: profile.learnedRules,
    stats: profile.stats,
    effectivePrefs: getEffectivePreferences(profile, category),
    learnedObservations: describeLearnedPreferences(profile).map((x) => x.text),
    recentApprovedAndCorrected: recentPos.map((x) => ({
      category: x.category,
      title: x.title,
      durSec: x.durSec,
      deltaStart: x.deltaS,
      deltaEnd: x.deltaE,
      addedContext: x.addedContextText,
      trimmedTail: x.trimmedTailText,
      tags: x.positiveTags,
      opening: x.openingText,
      closing: x.closingText,
    })),
    recentRejected: recentNeg.map((x) => ({
      category: x.category,
      reason: x.reason,
      title: x.title,
      durSec: x.durSec,
      opening: x.openingText,
      closing: x.closingText,
    })),
  };

  const sys = `You are a lead documentary and short-form video editorial director refining a creator's personal lecture-to-reels guidelines.
Review actual approved clips, manual boundary corrections (especially addedContext or trimmedTail), and rejection categories.
Guard against overlearning: generalize recurring principles (e.g., include setup sentence, finish full argument), NEVER brittle clichés ("every clip must start with a question").
Return JSON ONLY: {"rules":["rule 1","rule 2"],"category_rules":["optional rule specific to focusCategory"],"focus_note":"Concise summary of editorial improvement."}`;

  const res = await callJson(
    apiCfg,
    `Refine editorial rules based on real creator decisions:\n\n${JSON.stringify(payload)}`,
    sys,
    onNote
  );

  const nextRules = Array.isArray(res?.rules)
    ? res.rules.map((r) => String(r || '').trim()).filter((r) => r.length >= 14).slice(0, 10)
    : [];
  if (nextRules.length >= 2) {
    profile.learnedRules = nextRules;
  }

  if (category && category !== 'auto' && category !== 'general' && Array.isArray(res?.category_rules)) {
    if (!profile.categoryProfiles[category]) profile.categoryProfiles[category] = createCategoryPref(category);
    profile.categoryProfiles[category].learnedRules = res.category_rules
      .map((r) => String(r || '').trim())
      .filter((r) => r.length >= 12)
      .slice(0, 6);
  }

  profile.stats.reflections += 1;
  profile.profileVersion = (profile.profileVersion || 1) + 1;
  profile.pendingSignalsSinceReflect = 0;
  profile.lastReflectedAt = new Date().toISOString();
  profile.lastReflectedDay = todayKey();
  if (res?.focus_note) touchDailyActivity(profile, 'approve', res.focus_note);

  return saveTrainerProfile(profile);
}
