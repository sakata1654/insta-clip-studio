/**
 * Stage 1 & 2: Media Processing & Silence-Aware Audio Preprocessor
 * Based on PIPELINE_GUIDE.md T0, Appendix A2, and PIPELINE_REQUIREMENTS.md
 *
 * Implements:
 * 1. 16 kHz Mono PCM Audio Analysis
 * 2. 30ms RMS energy frames (fr = 480 samples at 16 kHz)
 * 3. Dynamic silence thresholding: thr = max(20th-percentile RMS * 1.5, 0.004)
 * 4. Silence-aware windowing: cuts at the quietest point in the second half of windows (18-24s)
 * 5. Silence window dropping: skips windows where >97% is below the silence threshold
 * 6. Overlap intervals (2.5s-3.5s) for robust boundary word reconciliation
 */

export const ASR_SAMPLE_RATE = 16000;
export const FRAME_MS = 30;
export const SAMPLES_PER_FRAME = (ASR_SAMPLE_RATE * FRAME_MS) / 1000; // 480 samples

/**
 * Computes root-mean-square (RMS) energy in consecutive 30ms frames.
 * @param {Float32Array} samples 16 kHz mono float32 samples
 * @returns {Float32Array} frame RMS values
 */
export function computeFrameRms(samples) {
  const numFrames = Math.floor(samples.length / SAMPLES_PER_FRAME);
  const rms = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const offset = f * SAMPLES_PER_FRAME;
    let sumSq = 0;
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      const s = samples[offset + i];
      sumSq += s * s;
    }
    rms[f] = Math.sqrt(sumSq / SAMPLES_PER_FRAME);
  }
  return rms;
}

/**
 * Computes a specific percentile value of a numeric array.
 * @param {Float32Array|Array<number>} arr
 * @param {number} p Percentile between 0 and 100
 * @returns {number}
 */
export function computePercentile(arr, p) {
  if (!arr.length) return 0;
  const copy = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.min(copy.length - 1, Math.max(0, Math.floor((p / 100) * copy.length)));
  return copy[idx];
}

/**
 * Applies a 5-frame moving average boxcar filter.
 * @param {Float32Array} arr
 * @returns {Float32Array}
 */
export function smoothFrames5(arr) {
  const len = arr.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -2; d <= 2; d++) {
      const idx = i + d;
      if (idx >= 0 && idx < len) {
        sum += arr[idx];
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : arr[i];
  }
  return out;
}

/**
 * Silence-aware chunking for ASR engines (Cohere, Whisper, Qwen, etc.).
 * Cuts audio windows (max 24s, min 2s) at the quietest point in their second half.
 * Drops windows that are >97% silence.
 * 
 * @param {Float32Array} samples 16 kHz mono float32 audio samples
 * @param {number} maxSec Maximum window duration in seconds (default 24.0)
 * @param {number} minSec Minimum window duration in seconds (default 2.0)
 * @param {number} overlapSec Overlap between consecutive windows (default 3.0)
 * @returns {Array<{ startSec: number, endSec: number, durationSec: number, isSilence: boolean }>}
 */
export function makeSilenceAwareChunks(samples, maxSec = 24.0, minSec = 2.0, overlapSec = 3.0) {
  const nFrames = Math.floor(samples.length / SAMPLES_PER_FRAME);
  if (nFrames <= 0) return [];

  const rms = computeFrameRms(samples);
  const p20 = computePercentile(rms, 20);
  const thr = Math.max(p20 * 1.5, 0.004);

  const chunks = [];
  let startFrame = 0;
  const spanFrames = Math.floor(maxSec / 0.03);
  const minFrames = Math.floor(minSec / 0.03);

  while (startFrame < nFrames) {
    let endFrame = Math.min(nFrames, startFrame + spanFrames);
    if (endFrame < nFrames) {
      // Find the quietest point in the second half of the window
      const lo = startFrame + Math.floor((endFrame - startFrame) / 2);
      const subRms = rms.slice(lo, endFrame);
      const smoothed = smoothFrames5(subRms);

      let minIdx = 0;
      let minVal = Infinity;
      for (let i = 0; i < smoothed.length; i++) {
        if (smoothed[i] < minVal) {
          minVal = smoothed[i];
          minIdx = i;
        }
      }
      endFrame = Math.max(lo + minIdx, startFrame + minFrames);
    }

    // Check silence fraction in this window
    let silenceCount = 0;
    const windowLen = endFrame - startFrame;
    for (let f = startFrame; f < endFrame; f++) {
      if (rms[f] < thr) silenceCount++;
    }
    const silenceRatio = windowLen > 0 ? silenceCount / windowLen : 1;
    const isSilence = silenceRatio >= 0.97;

    const startSec = Number((startFrame * 0.03).toFixed(2));
    const endSec = Number((endFrame * 0.03).toFixed(2));

    if (!isSilence) {
      chunks.push({
        startSec,
        endSec,
        durationSec: Number((endSec - startSec).toFixed(2)),
        isSilence: false,
      });
    }

    // Step forward, applying overlap if not at end
    if (endFrame >= nFrames) break;
    const overlapFrames = Math.floor(overlapSec / 0.03);
    startFrame = Math.max(startFrame + minFrames, endFrame - overlapFrames);
  }

  return chunks;
}

/**
 * Validates WAV header and extracts basic metadata.
 * @param {ArrayBuffer} buffer
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, numSamples: number, durationSec: number }}
 */
export function probeWavMetadata(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) throw new Error('WAV header too short');
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Invalid WAV header: missing RIFF signature');

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Find data chunk
  let pos = 36;
  let dataSize = 0;
  while (pos < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
  }

  const bytesPerSample = (bitsPerSample / 8) * channels;
  const numSamples = bytesPerSample > 0 ? Math.floor(dataSize / bytesPerSample) : 0;
  const durationSec = sampleRate > 0 ? numSamples / sampleRate : 0;

  return { sampleRate, channels, bitsPerSample, numSamples, durationSec };
}
