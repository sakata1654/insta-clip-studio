/**
 * Persistent Editorial Intelligence Storage, Privacy Controls,
 * Lecture Analysis Cache & Layer-4 Fine-Tuning Dataset Manager.
 */

export const PROFILE_STORAGE_KEY = 'icsEditorialIntelligenceV2';
export const LEGACY_V1_STORAGE_KEY = 'icsAiClipTrainerV1';
export const LECTURE_CACHE_KEY = 'icsLectureAnalysisCacheV1';

export const CONTENT_CATEGORIES = [
  { id: 'auto', label: 'Auto-Detect Content Type' },
  { id: 'islamic_lecture', label: 'Islamic Lecture / Khutbah / Dars' },
  { id: 'academic_lecture', label: 'Academic Lecture / Class' },
  { id: 'interview', label: 'Interview / Conversation' },
  { id: 'podcast', label: 'Podcast / Talk Show' },
  { id: 'educational_tutorial', label: 'Educational Tutorial' },
  { id: 'motivational', label: 'Motivational / Keynote Speech' },
  { id: 'debate', label: 'Discussion / Debate / Q&A' },
];

export const REJECT_REASONS = [
  { id: 'starts_too_late', label: 'Starts too late' },
  { id: 'starts_too_early', label: 'Starts too early' },
  { id: 'missing_context', label: 'Missing context' },
  { id: 'incomplete_explanation', label: 'Incomplete explanation' },
  { id: 'ends_abruptly', label: 'Ends too abruptly' },
  { id: 'uninteresting_topic', label: 'Uninteresting topic' },
  { id: 'repetitive', label: 'Repetitive content' },
  { id: 'poor_pacing', label: 'Poor pacing' },
  { id: 'unnatural_cuts', label: 'Unnatural speech cuts' },
  { id: 'too_long', label: 'Too long' },
  { id: 'too_short', label: 'Too short' },
  { id: 'other', label: 'Other' },
];

export const APPROVE_TAGS = [
  { id: 'excellent_opening', label: 'Excellent opening' },
  { id: 'complete_explanation', label: 'Complete explanation' },
  { id: 'great_storytelling', label: 'Great storytelling' },
  { id: 'strong_conclusion', label: 'Strong conclusion' },
  { id: 'interesting_topic', label: 'Interesting topic' },
  { id: 'perfect_duration', label: 'Perfect duration' },
  { id: 'natural_pacing', label: 'Natural pacing' },
  { id: 'standalone_context', label: 'Excellent standalone context' },
];

export const INTERACTION_WEIGHTS = {
  preview_open: 0.1,
  approve: 0.75,
  reject: 0.95,
  export: 1.25,
  manual_correction: 1.5,
};

export const DEFAULT_RANKING_WEIGHTS = {
  naturalBeginning: 1.35,
  completeThought: 1.45,
  standaloneContext: 1.35,
  naturalEnding: 1.3,
  storytelling: 1.0,
  educationalValue: 1.0,
  engagement: 0.9,
  durationFit: 0.75,
  pauseCleanliness: 0.85,
  contextLeadMatch: 0.8,
};

export const DEFAULT_RULES = [
  'Open at a natural sentence, question, observation, or topic transition with zero unexplained pronouns.',
  'Include enough setup context so someone who missed the rest of the 40-minute lecture understands the topic immediately.',
  'End cleanly after a completed thought, explanation, story resolution, or conclusion rather than mid-argument.',
  'Target 60–120 seconds for complete lecture ideas unless a shorter/longer span is clearly needed to preserve full meaning.',
];

const V1_REASON_MAP = {
  mid_thought: 'incomplete_explanation',
  weak_hook: 'starts_too_late',
  off_topic: 'uninteresting_topic',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeReasonId(r) {
  const raw = V1_REASON_MAP[r] || r;
  return REJECT_REASONS.some((x) => x.id === raw) ? raw : 'other';
}

function defaultStatPref(initialVal = 0.5) {
  return { value: initialVal, confidence: 0, count: 0 };
}

function emptyReasonCounts() {
  const out = {};
  for (const r of REJECT_REASONS) out[r.id] = 0;
  return out;
}

function emptyApproveTagCounts() {
  const out = {};
  for (const t of APPROVE_TAGS) out[t.id] = 0;
  return out;
}

export function createCategoryPref(category = 'general') {
  return {
    category,
    samples: 0,
    preferredDurSec: { value: 85, confidence: 0, count: 0 },
    contextLeadPreference: defaultStatPref(0.55),
    endingTightnessPreference: defaultStatPref(0.5),
    startOffsetBiasSec: defaultStatPref(0),
    endOffsetBiasSec: defaultStatPref(0),
    approveTags: emptyApproveTagCounts(),
    rejectReasons: emptyReasonCounts(),
    learnedRules: [],
  };
}

export function createDefaultProfile() {
  const now = new Date().toISOString();
  return {
    version: 2,
    profileVersion: 1,
    learningEnabled: true,
    createdAt: now,
    updatedAt: now,
    activeDays: [],
    stats: {
      generated: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      exported: 0,
      previewed: 0,
      trimCorrected: 0,
      extendedBeginningCount: 0,
      shortenedEndingCount: 0,
      avgDeltaStartSec: 0,
      avgDeltaEndSec: 0,
      reflections: 0,
    },
    globalPreferences: createCategoryPref('global'),
    categoryProfiles: {},
    learnedRules: [...DEFAULT_RULES],
    disabledPreferences: [],
    examples: [],
    rankingWeights: { ...DEFAULT_RANKING_WEIGHTS },
    batchHistory: [],
    benchmarkHistory: [],
    dailyLog: [],
    pendingSignalsSinceReflect: 0,
    lastReflectedAt: null,
    lastReflectedDay: null,
  };
}

function normalizeStatPref(raw, fallbackVal, minV, maxV) {
  if (typeof raw === 'number') {
    return { value: clamp(round2(raw), minV, maxV), confidence: 0.25, count: 1 };
  }
  if (!raw || typeof raw !== 'object') {
    return { value: fallbackVal, confidence: 0, count: 0 };
  }
  const count = Math.max(0, Math.round(Number(raw.count) || 0));
  return {
    value: clamp(round2(Number(raw.value ?? fallbackVal)), minV, maxV),
    confidence: clamp(round2(Number(raw.confidence ?? (count ? 1 - Math.exp(-count / 4.5) : 0))), 0, 1),
    count,
  };
}

function normalizeCatPref(raw, id) {
  const base = createCategoryPref(id);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    category: id,
    samples: Math.max(0, Math.round(Number(raw.samples) || 0)),
    preferredDurSec: normalizeStatPref(raw.preferredDurSec, 85, 15, 180),
    contextLeadPreference: normalizeStatPref(raw.contextLeadPreference, 0.55, 0, 1),
    endingTightnessPreference: normalizeStatPref(raw.endingTightnessPreference, 0.5, 0, 1),
    startOffsetBiasSec: normalizeStatPref(raw.startOffsetBiasSec, 0, -4, 4),
    endOffsetBiasSec: normalizeStatPref(raw.endOffsetBiasSec, 0, -4, 4),
    approveTags: { ...base.approveTags, ...(raw.approveTags || {}) },
    rejectReasons: { ...base.rejectReasons, ...(raw.rejectReasons || {}) },
    learnedRules: Array.isArray(raw.learnedRules) ? raw.learnedRules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8) : [],
  };
}

function migrateV1Profile(v1) {
  const p = createDefaultProfile();
  p.createdAt = v1.createdAt || p.createdAt;
  p.activeDays = Array.isArray(v1.activeDays) ? v1.activeDays.slice(-90) : [];
  p.stats.generated = v1.stats?.generated || 0;
  p.stats.approved = v1.stats?.approved || 0;
  p.stats.rejected = v1.stats?.rejected || 0;
  p.stats.reviewed = p.stats.approved + p.stats.rejected;
  p.stats.exported = v1.stats?.exported || 0;
  p.stats.trimCorrected = v1.stats?.trimCorrected || 0;
  p.stats.reflections = v1.stats?.reflections || 0;
  if (v1.preferences?.preferredDurSec) {
    p.globalPreferences.preferredDurSec = {
      value: clamp(Number(v1.preferences.preferredDurSec), 15, 180),
      confidence: p.stats.reviewed >= 3 ? 0.5 : 0.2,
      count: p.stats.reviewed,
    };
  }
  if (v1.preferences?.rejectReasons) {
    for (const [k, v] of Object.entries(v1.preferences.rejectReasons)) {
      const nid = normalizeReasonId(k);
      p.globalPreferences.rejectReasons[nid] = (p.globalPreferences.rejectReasons[nid] || 0) + (Number(v) || 0);
    }
  }
  for (const ex of v1.positiveExamples || []) {
    p.examples.push({
      id: ex.id || `pos_${Date.now()}_${Math.random()}`,
      decision: Math.abs(ex.trimDeltaS || 0) >= 0.5 || Math.abs(ex.trimDeltaE || 0) >= 0.5 ? 'manual_correction' : 'approve',
      weight: Math.abs(ex.trimDeltaS || 0) >= 0.5 ? INTERACTION_WEIGHTS.manual_correction : INTERACTION_WEIGHTS.approve,
      category: 'general',
      title: ex.title || 'Approved Clip',
      openingText: ex.hook || '',
      closingText: ex.ending || '',
      durSec: ex.dur || 60,
      deltaS: ex.trimDeltaS || 0,
      deltaE: ex.trimDeltaE || 0,
      positiveTags: [],
      note: ex.note || '',
      ts: ex.ts || new Date().toISOString(),
    });
  }
  for (const ex of v1.negativeExamples || []) {
    p.examples.push({
      id: ex.id || `neg_${Date.now()}_${Math.random()}`,
      decision: 'reject',
      weight: INTERACTION_WEIGHTS.reject,
      category: 'general',
      title: ex.title || 'Rejected Clip',
      openingText: ex.hook || '',
      closingText: ex.ending || '',
      durSec: ex.dur || 40,
      reason: normalizeReasonId(ex.reason),
      note: ex.note || '',
      ts: ex.ts || new Date().toISOString(),
    });
  }
  p.examples = p.examples.slice(-60);
  if (Array.isArray(v1.learnedRules) && v1.learnedRules.length) {
    p.learnedRules = v1.learnedRules.slice(0, 10);
  }
  p.dailyLog = Array.isArray(v1.dailyLog) ? v1.dailyLog.slice(-30) : [];
  return p;
}

export function normalizeTrainerProfile(raw) {
  if (raw && raw.version === 1) {
    raw = migrateV1Profile(raw);
  }
  const base = createDefaultProfile();
  if (!raw || typeof raw !== 'object') return base;

  const catProfiles = {};
  if (raw.categoryProfiles && typeof raw.categoryProfiles === 'object') {
    for (const [k, v] of Object.entries(raw.categoryProfiles)) {
      if (k && v) catProfiles[k] = normalizeCatPref(v, k);
    }
  }

  const rw = { ...DEFAULT_RANKING_WEIGHTS };
  if (raw.rankingWeights && typeof raw.rankingWeights === 'object') {
    for (const k of Object.keys(DEFAULT_RANKING_WEIGHTS)) {
      if (Number.isFinite(+raw.rankingWeights[k])) {
        rw[k] = clamp(round2(+raw.rankingWeights[k]), 0.2, 2.8);
      }
    }
  }

  return {
    ...base,
    ...raw,
    version: 2,
    profileVersion: Math.max(1, Math.round(Number(raw.profileVersion) || 1)),
    learningEnabled: raw.learningEnabled !== false,
    activeDays: Array.isArray(raw.activeDays) ? raw.activeDays.slice(-90) : [],
    stats: { ...base.stats, ...(raw.stats || {}) },
    globalPreferences: normalizeCatPref(raw.globalPreferences, 'global'),
    categoryProfiles: catProfiles,
    learnedRules:
      Array.isArray(raw.learnedRules) && raw.learnedRules.length
        ? raw.learnedRules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
        : [...DEFAULT_RULES],
    disabledPreferences: Array.isArray(raw.disabledPreferences) ? raw.disabledPreferences.slice(-30) : [],
    examples: Array.isArray(raw.examples) ? raw.examples.slice(-60) : [],
    rankingWeights: rw,
    batchHistory: Array.isArray(raw.batchHistory) ? raw.batchHistory.slice(-30) : [],
    benchmarkHistory: Array.isArray(raw.benchmarkHistory) ? raw.benchmarkHistory.slice(-20) : [],
    dailyLog: Array.isArray(raw.dailyLog) ? raw.dailyLog.slice(-30) : [],
    pendingSignalsSinceReflect: Math.max(0, Number(raw.pendingSignalsSinceReflect) || 0),
  };
}

export function loadTrainerProfile() {
  try {
    if (typeof localStorage === 'undefined') return createDefaultProfile();
    const rawV2 = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (rawV2) return normalizeTrainerProfile(JSON.parse(rawV2));
    const rawV1 = localStorage.getItem(LEGACY_V1_STORAGE_KEY);
    if (rawV1) {
      const migrated = normalizeTrainerProfile(JSON.parse(rawV1));
      saveTrainerProfile(migrated);
      return migrated;
    }
    return createDefaultProfile();
  } catch {
    return createDefaultProfile();
  }
}

export function saveTrainerProfile(profile) {
  const norm = normalizeTrainerProfile({ ...profile, updatedAt: new Date().toISOString() });
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(norm));
    }
  } catch {}
  return norm;
}

export function resetTrainerProfile() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_V1_STORAGE_KEY);
    }
  } catch {}
  return saveTrainerProfile(createDefaultProfile());
}

export function exportTrainerJson(profile = loadTrainerProfile()) {
  return JSON.stringify(normalizeTrainerProfile(profile), null, 2);
}

export function parseTrainerJson(jsonText) {
  const parsed = JSON.parse(String(jsonText || ''));
  if (!parsed || typeof parsed !== 'object' || (!parsed.stats && !parsed.learnedRules && !parsed.globalPreferences)) {
    throw new Error('Invalid Editorial Intelligence profile JSON.');
  }
  return saveTrainerProfile(parsed);
}

/* ---------- Lecture Analysis Cache (Avoid Re-Analyzing Same Transcript) ---------- */

export function hashTranscript(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + '_' + s.length;
}

export function loadCachedLectureAnalysis(transcriptHash) {
  try {
    if (typeof localStorage === 'undefined' || !transcriptHash) return null;
    const list = JSON.parse(localStorage.getItem(LECTURE_CACHE_KEY) || '[]');
    if (!Array.isArray(list)) return null;
    return list.find((x) => x && x.hash === transcriptHash) || null;
  } catch {
    return null;
  }
}

export function saveCachedLectureAnalysis(entry) {
  try {
    if (typeof localStorage === 'undefined' || !entry?.hash) return;
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(LECTURE_CACHE_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
    } catch {}
    list = list.filter((x) => x && x.hash !== entry.hash);
    list.unshift({ ...entry, cachedAt: Date.now() });
    localStorage.setItem(LECTURE_CACHE_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
}

/* ---------- Layer 4: Fine-Tuning Dataset Preparation Manager ---------- */

/**
 * Prepares validated, non-contradictory training & eval examples formatted for JSONL fine-tuning.
 * Note: Hosted model fine-tuning (OpenAI / open weights) is strictly user-authorized & external;
 * this module NEVER uploads user lectures automatically.
 */
export function buildFineTuneDataset(profile = loadTrainerProfile()) {
  const seenExcerpts = new Map();
  const clean = [];

  for (const ex of profile.examples || []) {
    if (!ex || !ex.openingText || !ex.closingText) continue;
    // Skip weak passive clicks; keep high-confidence explicit decisions & manual corrections
    if (ex.decision === 'preview_open') continue;
    const key = `${ex.openingText.slice(0, 60)}|${ex.closingText.slice(0, 60)}`.toLowerCase();
    const label = ex.decision === 'reject' ? 'reject' : 'accept';
    const prev = seenExcerpts.get(key);
    if (prev && prev.label !== label) {
      // Drop contradictory labels rather than poisoning training set
      prev.contradictory = true;
      continue;
    }
    const item = { ex, label, contradictory: false };
    seenExcerpts.set(key, item);
    clean.push(item);
  }

  const valid = clean.filter((x) => !x.contradictory);
  const train = [];
  const evalSet = [];

  valid.forEach((item, idx) => {
    const e = item.ex;
    const record = {
      messages: [
        {
          role: 'system',
          content: `Evaluate short-form lecture reel candidate (${e.category || 'general'}). Classify acceptance and editorial reasoning cleanly.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            category: e.category || 'general',
            durationSec: e.durSec || 60,
            opening: e.openingText,
            closing: e.closingText,
            excerpt: e.fullExcerpt || `${e.openingText} ... ${e.closingText}`,
          }),
        },
        {
          role: 'assistant',
          content: JSON.stringify({
            decision: item.label,
            reason: e.reason || (e.positiveTags || []).join(', ') || (item.label === 'accept' ? 'complete_standalone_thought' : 'editorial_reject'),
            correctionApplied: e.decision === 'manual_correction',
            deltaStartSec: e.deltaS || 0,
            deltaEndSec: e.deltaE || 0,
          }),
        },
      ],
    };
    // Deterministic 80/20 stratified-by-index split
    if (idx % 5 === 4) evalSet.push(record);
    else train.push(record);
  });

  const ready = train.length >= 25 && evalSet.length >= 5;
  return {
    totalClean: valid.length,
    trainCount: train.length,
    evalCount: evalSet.length,
    readyForExternalFineTune: ready,
    reason: ready
      ? 'Dataset meets minimum clean threshold (25+ train / 5+ eval non-contradictory examples).'
      : `Need at least 25 clean train & 5 eval examples (currently ${train.length} train / ${evalSet.length} eval). Layers 1–3 continue adapting immediately without model retraining.`,
    trainJsonl: train.map((r) => JSON.stringify(r)).join('\n'),
    evalJsonl: evalSet.map((r) => JSON.stringify(r)).join('\n'),
  };
}
