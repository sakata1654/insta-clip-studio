import { INTERACTION_WEIGHTS, loadTrainerProfile, saveTrainerProfile } from './lectureStorage.js';
import { describeLearnedPreferences, scoreClipWithPersonalizedRanker } from './preferenceLearning.js';

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

/**
 * Layer 2 — Similarity-Based Example Retrieval:
 * Fetches ONLY the top relevant accepted, boundary-corrected (AI -> User),
 * and rejected examples matching the active lecture category & topic text
 * so prompts stay small, fast, and context-relevant.
 */
export function retrieveRelevantExamples(
  profile = loadTrainerProfile(),
  { category = 'general', subjectText = '', limitPositive = 3, limitCorrections = 3, limitNegative = 4 } = {}
) {
  const examples = profile.examples || [];
  if (!examples.length) {
    return { positive: [], corrections: [], negative: [] };
  }
  const queryTokens = tokenize(subjectText);

  const scored = examples.map((ex, idx) => {
    const sameCat = category && category !== 'auto' && ex.category === category ? 0.55 : ex.category === 'general' ? 0.15 : 0;
    const textTokens = tokenize(`${ex.title || ''} ${ex.topic || ''} ${ex.openingText || ''} ${ex.addedContextText || ''}`);
    const sim = jaccard(queryTokens, textTokens);
    const recency = (idx + 1) / examples.length;
    const weightBoost = (ex.weight || 0.7) * 0.35;
    return {
      ex,
      rel: sameCat + sim * 0.9 + recency * 0.3 + weightBoost,
    };
  });

  scored.sort((a, b) => b.rel - a.rel);

  const positive = scored
    .filter((x) => x.ex.decision === 'approve' || x.ex.decision === 'export')
    .slice(0, limitPositive)
    .map((x) => x.ex);

  const corrections = scored
    .filter((x) => x.ex.decision === 'manual_correction' && (x.ex.addedContextText || x.ex.trimmedTailText || Math.abs(x.ex.deltaS) >= 1 || Math.abs(x.ex.deltaE) >= 1))
    .slice(0, limitCorrections)
    .map((x) => x.ex);

  const negative = scored
    .filter((x) => x.ex.decision === 'reject')
    .slice(0, limitNegative)
    .map((x) => x.ex);

  return { positive, corrections, negative };
}

/* ---------- Part 5: Evaluation & Regression Benchmarking Engine ---------- */

/**
 * Records summary telemetry for a single lecture clip-generation batch so genuine
 * acceptance & correction trends can be tracked across sessions.
 */
export function recordLectureBatchSummary(lectureHash, category, candidateCount) {
  const profile = loadTrainerProfile();
  profile.batchHistory.push({
    ts: new Date().toISOString(),
    lectureHash,
    category,
    generated: candidateCount,
    approvedAtGen: profile.stats.approved || 0,
    rejectedAtGen: profile.stats.rejected || 0,
    correctedAtGen: profile.stats.trimCorrected || 0,
  });
  profile.batchHistory = profile.batchHistory.slice(-30);
  return saveTrainerProfile(profile);
}

/**
 * Evaluates current PersonalizedRanker weights against a fixed historical set of reviewed examples:
 * computes pairwise ordering accuracy (accepted/exported vs rejected) + high-confidence recall
 * without fabricating any numbers.
 */
export function evaluateAgainstBenchmark(profile = loadTrainerProfile(), saveResult = false) {
  const positives = (profile.examples || []).filter(
    (x) => (x.decision === 'approve' || x.decision === 'export' || x.decision === 'manual_correction') && x.features
  );
  const negatives = (profile.examples || []).filter((x) => x.decision === 'reject' && x.features);

  let pairs = 0;
  let wins = 0;
  for (const pos of positives) {
    const pRank = scoreClipWithPersonalizedRanker({ ...pos, features: pos.features, critical_scores: pos.criticalScores }, profile, pos.category).rankScore;
    for (const neg of negatives) {
      const nRank = scoreClipWithPersonalizedRanker({ ...neg, features: neg.features, critical_scores: neg.criticalScores }, profile, neg.category).rankScore;
      pairs++;
      if (pRank > nRank) wins++;
      else if (pRank === nRank) wins += 0.5;
    }
  }

  const pairwiseAccuracy = pairs > 0 ? Math.round((wins / pairs) * 100) : null;
  const s = profile.stats || {};
  const reviewed = s.reviewed || 0;
  const acceptanceRate = reviewed > 0 ? Math.round(((s.approved || 0) / reviewed) * 100) : null;
  const correctionRate = reviewed > 0 ? Math.round(((s.trimCorrected || 0) / reviewed) * 100) : null;
  const exportRate = reviewed > 0 ? Math.round(((s.exported || 0) / reviewed) * 100) : null;

  const evalReport = {
    ts: new Date().toISOString(),
    benchmarkPairs: pairs,
    positiveSamples: positives.length,
    negativeSamples: negatives.length,
    pairwiseAccuracy,
    acceptanceRate,
    approvalRate: acceptanceRate,
    correctionRate,
    exportRate,
    avgDeltaStartSec: s.avgDeltaStartSec || 0,
    avgDeltaEndSec: s.avgDeltaEndSec || 0,
  };

  if (saveResult) {
    const next = loadTrainerProfile();
    next.benchmarkHistory.push(evalReport);
    next.benchmarkHistory = next.benchmarkHistory.slice(-20);
    saveTrainerProfile(next);
  }
  return evalReport;
}

/**
 * Returns real, inspectable Editorial Intelligence stats strictly derived from stored history.
 */
export function getEditorialSummary(profile = loadTrainerProfile()) {
  const s = profile.stats || {};
  const reviewed = (s.approved || 0) + (s.rejected || 0);
  const acceptanceRate = reviewed > 0 ? Math.round(((s.approved || 0) / reviewed) * 100) : null;
  const correctionRate = reviewed > 0 ? Math.round(((s.trimCorrected || 0) / reviewed) * 100) : null;
  const g = profile.globalPreferences;

  const commonRejects = Object.entries(g.rejectReasons || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, count]) => ({ id, count }));

  return {
    learningEnabled: profile.learningEnabled !== false,
    profileVersion: profile.profileVersion || 1,
    daysTrained: (profile.activeDays || []).length,
    reviewed: s.reviewed || reviewed,
    approved: s.approved || 0,
    rejected: s.rejected || 0,
    exported: s.exported || 0,
    trimCorrected: s.trimCorrected || 0,
    extendedBeginningCount: s.extendedBeginningCount || 0,
    shortenedEndingCount: s.shortenedEndingCount || 0,
    reflections: s.reflections || 0,
    acceptanceRate,
    approvalRate: acceptanceRate,
    correctionRate,
    preferredDurSec: Math.round(g.preferredDurSec?.value || 85),
    preferredDurConfidence: round2(g.preferredDurSec?.confidence || 0),
    avgDeltaStartSec: s.avgDeltaStartSec || 0,
    avgDeltaEndSec: s.avgDeltaEndSec || 0,
    startBiasMs: Math.round((g.startOffsetBiasSec?.value || 0) * 1000),
    endBiasMs: Math.round((g.endOffsetBiasSec?.value || 0) * 1000),
    ruleCount: (profile.learnedRules || []).length,
    categoryCount: Object.keys(profile.categoryProfiles || {}).length,
    exampleCount: (profile.examples || []).length,
    pendingSignals: profile.pendingSignalsSinceReflect || 0,
    commonRejects,
    learnedPreferences: describeLearnedPreferences(profile),
    lastReflectedAt: profile.lastReflectedAt,
  };
}
