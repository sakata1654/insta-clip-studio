/**
 * Browser-Native Web Audio Tools:
 * 1) Extracts lightweight 16 kHz mono WAV chunks directly from local Video/Audio files
 *    so multi-hundred-MB videos never need to be uploaded for cloud transcription!
 * 2) Generates waveform peak arrays for visual audio/timeline rendering.
 * 3) Mixes trimmed source + custom audio tracks into AudioBuffer for WebCodecs AAC export.
 */

import { createIntelligentAudioChunks } from '../transcriptEngine/audioChunker.js';
import { extractMp4AacChunks } from './mp4AudioDemuxer.js';

const SAMPLE_RATE_ASR = 16000;
const CHUNK_SECONDS_ASR = 105; // 105s * 16000 * 2 bytes = ~3.36 MB WAV (< 4.2 MB Vercel body cap!)
const OVERLAP_SECONDS_ASR = 4; // 4s overlap prevents losing words across chunk boundaries

export async function decodeMediaAudio(fileOrBlob) {
  if (!fileOrBlob) throw new Error('No media file provided for audio decoding.');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio API is not available in this browser.');
  const ctx = new Ctx();
  try {
    const ab = await fileOrBlob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(ab);
    return audioBuf;
  } finally {
    try { await ctx.close(); } catch {}
  }
}

function encodeWavMono16(float32Samples, sampleRate) {
  const numSamples = float32Samples.length;
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const v = new DataView(buf);
  const wStr = (off, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
  };
  wStr(0, 'RIFF');
  v.setUint32(4, 36 + numSamples * 2, true);
  wStr(8, 'WAVE');
  wStr(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM
  v.setUint16(20, 1, true); // Linear PCM
  v.setUint16(22, 1, true); // Mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wStr(36, 'data');
  v.setUint32(40, numSamples * 2, true);

  let pos = 44;
  for (let i = 0; i < numSamples; i++, pos += 2) {
    const s = Math.max(-1, Math.min(1, float32Samples[i]));
    v.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function uint8ToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Extracts lightweight audio chunks locally from Video/Audio files for cloud transcription:
 * 1) For MP4/MOV/M4V/M4A (or when mobile AudioContext.decodeAudioData fails), demuxes the
 *    AAC audio stream directly via File.slice() without loading full video into RAM.
 * 2) Otherwise decodes via Web Audio API and downsamples to 16 kHz mono WAV chunks (< 3.5 MB each).
 */
export async function extractAsrWavChunks(fileOrBlob, onProgress) {
  const name = String(fileOrBlob?.name || '').toLowerCase();
  const mime = String(fileOrBlob?.type || '').toLowerCase();
  const looksMp4 = /\.(mp4|mov|m4v|m4a|3gp)$/.test(name) || /mp4|quicktime/.test(mime);

  // Prefer streaming MP4 AAC demuxer on MP4/MOV files (prevents mobile decodeAudioData failures & RAM spikes)
  if (looksMp4 && typeof fileOrBlob?.slice === 'function') {
    try {
      const demuxed = await extractMp4AacChunks(fileOrBlob, onProgress, {
        chunkSec: CHUNK_SECONDS_ASR,
        overlapSec: OVERLAP_SECONDS_ASR,
      });
      if (demuxed && demuxed.chunks?.length) return demuxed;
    } catch {
      // Fall through to Web Audio decode fallback
    }
  }

  let decoded;
  try {
    if (onProgress) onProgress(5, 'Decoding audio locally via Web Audio…');
    decoded = await decodeMediaAudio(fileOrBlob);
  } catch (err) {
    // Second-chance MP4 demuxer even if extension/MIME was missing
    if (typeof fileOrBlob?.slice === 'function') {
      try {
        const demuxed = await extractMp4AacChunks(fileOrBlob, onProgress, {
          chunkSec: CHUNK_SECONDS_ASR,
          overlapSec: OVERLAP_SECONDS_ASR,
        });
        if (demuxed && demuxed.chunks?.length) return demuxed;
      } catch {}
    }
    // Small audio/webm fallback: upload directly if under 2.8 MB
    if (fileOrBlob?.size > 0 && fileOrBlob.size <= 2_800_000) {
      const bytes = new Uint8Array(await fileOrBlob.arrayBuffer());
      return {
        duration: 0,
        chunks: [{
          startOffsetSec: 0,
          durationSec: 0,
          overlapSec: 0,
          mimeType: (fileOrBlob.type && !fileOrBlob.type.includes('aac')) ? fileOrBlob.type : 'audio/mp4',
          wavBytes: bytes,
        }],
      };
    }
    throw new Error(`Browser audio decoding failed (${err?.message || 'unsupported codec'}). Try MP4/AAC or an audio file (MP3/M4A/WAV).`);
  }

  const dur = decoded.duration;
  const totalOutSamples = Math.max(1, Math.ceil(dur * SAMPLE_RATE_ASR));

  if (onProgress) onProgress(22, 'Resampling to 16 kHz mono for lightweight transcription…');
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Offline(1, totalOutSamples, SAMPLE_RATE_ASR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const mono = rendered.getChannelData(0);

  const intelligentChunks = createIntelligentAudioChunks(mono, SAMPLE_RATE_ASR, 3.0);
  const chunks = [];
  for (const ic of intelligentChunks) {
    const wavBytes = encodeWavMono16(mono.subarray(ic.startSample, ic.endSample), SAMPLE_RATE_ASR);
    chunks.push({
      startOffsetSec: ic.startOffsetSec,
      durationSec: ic.durationSec,
      overlapSec: ic.overlapSec,
      mimeType: 'audio/wav',
      wavBytes,
    });
  }
  return { duration: dur, chunks };
}

/**
 * Generates normalized waveform peaks [0..1] for rendering audio waveforms on timeline tracks.
 */
export async function computeWaveformPeaks(fileOrBlob, bucketCount = 320) {
  try {
    const buf = await decodeMediaAudio(fileOrBlob);
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bucketCount));
    const peaks = new Array(bucketCount).fill(0);
    for (let i = 0; i < bucketCount; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(ch.length, start + step);
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks[i] = Math.round(max * 1000) / 1000;
    }
    return { duration: buf.duration, peaks };
  } catch {
    return { duration: 0, peaks: [] };
  }
}

/**
 * Renders trimmed + mixed stereo AudioBuffer (source video audio + optional music/voiceover track)
 * for WebCodecs AudioEncoder + mp4-muxer export.
 */
export async function renderMixedExportAudio({
  sourceFile,
  musicFile = null,
  trimS = 0,
  trimE = 0,
  sourceVol = 100,
  musicVol = 100,
  speed = 1,
  sampleRate = 48000,
}) {
  const durRaw = Math.max(0.1, trimE - trimS);
  const outDur = durRaw / Math.max(0.25, speed || 1);
  const totalSamples = Math.max(1, Math.ceil(outDur * sampleRate));
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Offline(2, totalSamples, sampleRate);
  let hasAnyAudio = false;

  if (sourceFile && sourceVol > 0) {
    try {
      const sBuf = await decodeMediaAudio(sourceFile);
      const sNode = off.createBufferSource();
      sNode.buffer = sBuf;
      sNode.playbackRate.value = Math.max(0.25, speed || 1);
      const g = off.createGain();
      g.gain.value = Math.min(2, Math.max(0, sourceVol / 100));
      sNode.connect(g);
      g.connect(off.destination);
      sNode.start(0, Math.max(0, trimS), Math.min(durRaw, Math.max(0.05, sBuf.duration - trimS)));
      hasAnyAudio = true;
    } catch {}
  }

  if (musicFile && musicVol > 0) {
    try {
      const mBuf = await decodeMediaAudio(musicFile);
      const mNode = off.createBufferSource();
      mNode.buffer = mBuf;
      mNode.loop = mBuf.duration < outDur;
      const g = off.createGain();
      g.gain.value = Math.min(2, Math.max(0, musicVol / 100));
      mNode.connect(g);
      g.connect(off.destination);
      mNode.start(0, 0, outDur);
      hasAnyAudio = true;
    } catch {}
  }

  if (!hasAnyAudio) return null;
  return await off.startRendering();
}
