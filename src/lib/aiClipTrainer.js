/**
 * Unified AI Clip & Self-Improving Editorial Intelligence Facade.
 * Re-exports modular Lecture Analyzer, Preference Learning, Example Retrieval,
 * Personalized Ranker, Dataset Manager, and Benchmarking modules cleanly.
 */

export {
  APPROVE_TAGS,
  CONTENT_CATEGORIES,
  INTERACTION_WEIGHTS,
  PROFILE_STORAGE_KEY as TRAINER_STORAGE_KEY,
  REJECT_REASONS,
  buildFineTuneDataset,
  createDefaultProfile,
  exportTrainerJson,
  loadTrainerProfile,
  parseTrainerJson,
  resetTrainerProfile,
  saveTrainerProfile,
  todayKey,
} from './lectureEngine/lectureStorage.js';

export {
  describeLearnedPreferences,
  extractClipFeatures,
  getEffectivePreferences,
  recordClipFeedback,
  recordTrimAdjustment,
  runSelfTrainingReflection,
  scoreClipWithPersonalizedRanker,
} from './lectureEngine/preferenceLearning.js';

export {
  evaluateAgainstBenchmark,
  getEditorialSummary as getTrainerSummary,
  retrieveRelevantExamples,
} from './lectureEngine/exampleRetrieval.js';

export {
  dedupeLectureClips,
  findSmartClips,
  prepareCueTranscript,
  snapClipBoundaries,
} from './lectureEngine/lectureAnalyzer.js';
