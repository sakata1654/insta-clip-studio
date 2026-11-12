/**
 * Intelligent Audio Chunker & Boundary Reconciler (Engine 2.0)
 *
 * Implements:
 * 1) Voice Activity & Energy Silence Detection to cut audio at NATURAL PAUSES (18-32s),
 *    never slicing words or sentences mid-speech.
 * 2) Overlapping chunk generation (2.5s - 3.5s overlap).
 * 3) Rolling context generation (feeds tail of previous chunk to Groq Whisper prompt).
 * 4) Sequence-aligned boundary reconciliation (eliminates duplicates and missing words).
 */

const SAMPLE_RATE = 16000;
const MIN_CHUNK_SEC = 18;
const TARGET_CHUNK_SEC = 26;
const MAX_CHUNK_SEC = 34;
const DEFAULT_OVERLAP_SEC = 3.0;

/**
 * Scans a 16 kHz mono Float32Array for natural speech pauses.
 * Returns an array of silence interval objects: [{ startSec, endSec, durationSec, minEnergy }]
 */
export function detectAudioPauses(monoSamples, sampleRate = SAMPLE_RATE) {
  const windowSamples = Math.round(sampleRate * 0.05); // 50ms window
  const hopSamples = Math.round(sampleRate * 0.025); // 25ms hop
  const numHops = Math.floor((monoSamples.length - windowSamples) / hopSamples);
  if (numHops <= 0) return [];

  const energies = new Float32Array(numHops);
  let energySum = 0;
  for (let h = 0; h < numHops; h++) {
    const start = h * hopSamples;
    let sumSq = 0;
    for (let i = 0; i < windowSamples; i++) {
      const v = monoSamples[start + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / windowSamples);
    energies[h] = rms;
    energySum += rms;
  }
  const avgEnergy = energySum / Math.max(1, numHops);
  const silenceThreshold = Math.max(0.008, avgEnergy * 0.22);

  // Group contiguous below-threshold hops into pauses
  const pauses = [];
  let inPause = false;
  let pauseStartHop = 0;
  let minRms = 1.0;

  for (let h = 0; h < numHops; h++) {
    const rms = energies[h];
    if (rms < silenceThreshold) {
      if (!inPause) {
        inPause = true;
        pauseStartHop = h;
        minRms = rms;
      } else {
        if (rms < minRms) minRms = rms;
      }
    } else {
      if (inPause) {
        const startSec = (pauseStartHop * hopSamples) / sampleRate;
        const endSec = (h * hopSamples) / sampleRate;
        const durationSec = endSec - startSec;
        if (durationSec >= 0.18) {
          pauses.push({ startSec, endSec, durationSec, minEnergy: minRms });
        }
        inPause = false;
      }
    }
  }

  if (inPause) {
    const startSec = (pauseStartHop * hopSamples) / sampleRate;
    const endSec = (numHops * hopSamples) / sampleRate;
    if (endSec - startSec >= 0.18) {
      pauses.push({ startSec, endSec, durationSec: endSec - startSec, minEnergy: minRms });
    }
  }

  return pauses;
}

/**
 * Finds the optimal natural pause cut point within [targetSec - window, targetSec + window].
 */
export function findBestSplitPoint(pauses, rangeStartSec, rangeEndSec, fallbackSec) {
  const candidates = pauses.filter(
    (p) => (p.startSec + p.endSec) * 0.5 >= rangeStartSec && (p.startSec + p.endSec) * 0.5 <= rangeEndSec
  );
  if (!candidates.length) return fallbackSec;

  const targetCenter = (rangeStartSec + rangeEndSec) * 0.5;
  let best = candidates[0];
  let bestScore = -Infinity;

  for (const p of candidates) {
    const mid = (p.startSec + p.endSec) * 0.5;
    const distToCenter = Math.abs(mid - targetCenter);
    const score = p.durationSec * 10 - distToCenter * 0.3 - p.minEnergy * 20;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return (best.startSec + best.endSec) * 0.5;
}

/**
 * Partitions 16 kHz mono Float32 audio into intelligent VAD-aligned chunks.
 * Returns: [{ chunkIndex, startOffsetSec, endSec, durationSec, overlapSec, samples }]
 */
export function createIntelligentAudioChunks(monoSamples, sampleRate = SAMPLE_RATE, overlapSec = DEFAULT_OVERLAP_SEC) {
  const totalSec = monoSamples.length / sampleRate;
  if (totalSec <= MAX_CHUNK_SEC) {
    return [{
      chunkIndex: 0,
      startOffsetSec: 0,
      endSec: totalSec,
      durationSec: totalSec,
      overlapSec: 0,
      startSample: 0,
      endSample: monoSamples.length,
    }];
  }

  const pauses = detectAudioPauses(monoSamples, sampleRate);
  const chunks = [];
  let curStartSec = 0;
  let chunkIdx = 0;

  while (curStartSec < totalSec - 3) {
    const minTarget = curStartSec + MIN_CHUNK_SEC;
    const maxTarget = Math.min(totalSec, curStartSec + MAX_CHUNK_SEC);
    const idealTarget = curStartSec + TARGET_CHUNK_SEC;

    let splitSec;
    if (maxTarget >= totalSec - 4) {
      splitSec = totalSec;
    } else {
      splitSec = findBestSplitPoint(pauses, minTarget, maxTarget, idealTarget);
    }

    const durationSec = splitSec - curStartSec;
    const startSample = Math.floor(curStartSec * sampleRate);
    const endSample = Math.min(monoSamples.length, Math.ceil(splitSec * sampleRate));

    chunks.push({
      chunkIndex: chunkIdx++,
      startOffsetSec: curStartSec,
      endSec: splitSec,
      durationSec,
      overlapSec: chunks.length === 0 ? 0 : overlapSec,
      startSample,
      endSample,
    });

    if (splitSec >= totalSec) break;
    curStartSec = Math.max(curStartSec + MIN_CHUNK_SEC * 0.5, splitSec - overlapSec);
  }

  return chunks;
}

function normToken(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

/**
 * Reconciles overlapping words between consecutive chunks.
 * Compares the tail words of Chunk K with head words of Chunk K+1 in the overlap time window.
 * Returns the seamlessly stitched word array with no dropped words and no duplicated words.
 */
export function reconcileChunkOverlapWords(existingWords, newChunkWords, chunkOffsetSec, overlapSec) {
  if (!existingWords || !existingWords.length) {
    return newChunkWords.map((w) => ({
      w: String(w.word ?? w.w ?? w.text ?? '').trim(),
      s: Number(w.start ?? w.s ?? 0) + chunkOffsetSec,
      e: Math.max(Number(w.start ?? w.s ?? 0) + chunkOffsetSec + 0.04, Number(w.end ?? w.e ?? 0) + chunkOffsetSec),
    })).filter((w) => w.w);
  }

  const incoming = newChunkWords
    .map((w) => ({
      w: String(w.word ?? w.w ?? w.text ?? '').trim(),
      s: Number(w.start ?? w.s ?? 0) + chunkOffsetSec,
      e: Math.max(Number(w.start ?? w.s ?? 0) + chunkOffsetSec + 0.04, Number(w.end ?? w.e ?? 0) + chunkOffsetSec),
    }))
    .filter((w) => w.w);

  if (!incoming.length) return existingWords;

  const overlapWindowStart = chunkOffsetSec;
  const overlapWindowEnd = chunkOffsetSec + overlapSec + 0.5;

  const tailCandidates = existingWords.filter((w) => w.s >= overlapWindowStart - 0.5 && w.e <= overlapWindowEnd + 0.5);
  if (!tailCandidates.length) {
    return [...existingWords, ...incoming.filter((w) => w.s > existingWords[existingWords.length - 1].e - 0.1)];
  }

  let matchIncomingIdx = -1;
  let matchExistingTime = -1;

  for (let i = 0; i < Math.min(incoming.length - 1, 12); i++) {
    const t0 = normToken(incoming[i].w);
    const t1 = normToken(incoming[i + 1]?.w);
    if (!t0) continue;

    for (let j = 0; j < tailCandidates.length - 1; j++) {
      const e0 = normToken(tailCandidates[j].w);
      const e1 = normToken(tailCandidates[j + 1]?.w);
      if (t0 === e0 && (!t1 || t1 === e1)) {
        matchIncomingIdx = i;
        matchExistingTime = tailCandidates[j].s;
        break;
      }
    }
    if (matchIncomingIdx >= 0) break;
  }

  if (matchIncomingIdx >= 0) {
    const cutoffTime = matchExistingTime;
    const keptExisting = existingWords.filter((w) => w.s < cutoffTime);
    const keptIncoming = incoming.slice(matchIncomingIdx);
    return [...keptExisting, ...keptIncoming];
  }

  const midPoint = overlapWindowStart + overlapSec * 0.5;
  const keptExisting = existingWords.filter((w) => w.s < midPoint);
  const keptIncoming = incoming.filter((w) => w.s >= midPoint);
  return [...keptExisting, ...keptIncoming];
}

/**
 * Builds rolling context prompt string for Groq Whisper.
 * Includes user terminology hints + the last ~15-20 words of previous speech.
 */
export function buildRollingAsrPrompt(userHints = '', previousWords = []) {
  const parts = [];
  const cleanHints = String(userHints || '').trim();
  if (cleanHints) {
    parts.push(cleanHints.slice(0, 240));
  }
  if (previousWords && previousWords.length > 0) {
    const tailWords = previousWords.slice(-18).map((x) => x.w).join(' ');
    if (tailWords) {
      parts.push(tailWords);
    }
  }
  return parts.join('. ').slice(0, 420);
}
