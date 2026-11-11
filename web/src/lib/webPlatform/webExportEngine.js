import { renderMixedExportAudio } from './webAudioTools.js';

export async function getBrowserCapabilities() {
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
  let webcodecsH264 = false;
  let negotiatedCodec = null;
  if (hasVideoEncoder) {
    for (const codec of ['avc1.4d002a', 'avc1.420028', 'avc1.42001f']) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width: 1080,
          height: 1920,
          bitrate: 8_000_000,
          framerate: 30,
        });
        if (res?.supported) {
          webcodecsH264 = true;
          negotiatedCodec = codec;
          break;
        }
      } catch {}
    }
  }
  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const hasFileSystemAccess = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
  const hasIndexedDb = typeof indexedDB !== 'undefined';
  const crossOriginIsolated = typeof globalThis !== 'undefined' && !!globalThis.crossOriginIsolated;
  const mediaRecorderMime =
    typeof MediaRecorder !== 'undefined'
      ? ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
          MediaRecorder.isTypeSupported(m)
        ) || null
      : null;

  return {
    webcodecsH264,
    hasAudioEncoder,
    negotiatedCodec,
    hasOffscreenCanvas,
    hasFileSystemAccess,
    hasIndexedDb,
    crossOriginIsolated,
    mediaRecorderMime,
  };
}

export function scaleDimensionsForExport(lw, lh, targetHeightOrSource = 'source') {
  const makeEven = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (!targetHeightOrSource || targetHeightOrSource === 'source') {
    return { w: makeEven(lw), h: makeEven(lh) };
  }
  const targetShort = Number(targetHeightOrSource) || 1080;
  const minSide = Math.min(lw, lh);
  const scale = minSide > targetShort ? targetShort / minSide : 1;
  return { w: makeEven(lw * scale), h: makeEven(lh * scale) };
}

/**
 * WebCodecs Hardware-Accelerated Background MP4 Export:
 * Steps accurately through [trimS..trimE] on isolated offscreen <video> + overlays,
 * renders full Canvas 2D composite via supplied renderFrameFn(canvas, jobCtx),
 * transfers VideoFrame objects to Web Worker (`mp4-muxer`), mixes trimmed AudioBuffer via AudioEncoder.
 */
export async function exportWithWebCodecs({
  jobCtx,
  jobV,
  renderFrameFn,
  sourceFile,
  musicFile = null,
  sourceVol = 100,
  musicVol = 100,
  width,
  height,
  fps = 30,
  bitrateMbps = 10,
  onProgress,
  isCancelled,
}) {
  const caps = await getBrowserCapabilities();
  if (!caps.webcodecsH264) {
    throw new Error('WebCodecs H.264 is unavailable in this browser.');
  }

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const bgCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(Math.max(32, Math.round(width / 10)), Math.max(32, Math.round(height / 10)))
      : Object.assign(document.createElement('canvas'), {
          width: Math.max(32, Math.round(width / 10)),
          height: Math.max(32, Math.round(height / 10)),
        });
  const bgCtx = bgCanvas.getContext('2d');

  // Set job dimensions to export resolution so compositor scales everything proportionally
  const origLW = jobCtx.LW;
  const origLH = jobCtx.LH;
  jobCtx.LW = width;
  jobCtx.LH = height;

  // Mix audio completely offline first (fast, non-blocking)
  if (onProgress) onProgress(4, 'Mixing audio tracks…');
  let mixedAudio = null;
  if (caps.hasAudioEncoder) {
    try {
      mixedAudio = await renderMixedExportAudio({
        sourceFile,
        musicFile,
        trimS: jobCtx.trimS,
        trimE: jobCtx.trimE,
        sourceVol,
        musicVol,
        speed: jobCtx.speed || 1,
        sampleRate: 48000,
      });
    } catch {}
  }

  const worker = new Worker(new URL('./webExportWorker.js', import.meta.url), { type: 'module' });
  let workerErr = null;
  let lastAck = -1;

  const waitMessage = (targetType) =>
    new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        const m = ev.data || {};
        if (m.type === 'error') {
          cleanupListen();
          reject(new Error(m.message || 'Export worker error'));
        } else if (m.type === targetType) {
          cleanupListen();
          resolve(m);
        } else if (m.type === 'frame-ack') {
          lastAck = m.index;
        }
      };
      const onErr = (err) => {
        cleanupListen();
        reject(new Error(err?.message || 'Worker crashed'));
      };
      const cleanupListen = () => {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onErr);
    });

  worker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'frame-ack') lastAck = ev.data.index;
    else if (ev.data?.type === 'error') workerErr = new Error(ev.data.message || 'Encoder failed');
  });

  const seekEl = (el, t) =>
    new Promise((resolve) => {
      const clamped = Math.max(0, Math.min(Number(el.duration) || t, t));
      if (Math.abs((el.currentTime || 0) - clamped) < 0.008 && el.readyState >= 2) return resolve();
      let fin = false;
      const done = () => {
        if (fin) return;
        fin = true;
        clearTimeout(tm);
        el.removeEventListener('seeked', done);
        resolve();
      };
      const tm = setTimeout(done, 1500);
      el.addEventListener('seeked', done, { once: true });
      try {
        el.currentTime = clamped;
      } catch {
        done();
      }
    });

  try {
    const readyP = waitMessage('ready');
    worker.postMessage({
      type: 'init',
      width,
      height,
      fps,
      videoBitrate: Math.round((Number(bitrateMbps) || 10) * 1_000_000),
      hasAudio: !!mixedAudio,
      sampleRate: mixedAudio ? mixedAudio.sampleRate : 48000,
      channels: mixedAudio ? mixedAudio.numberOfChannels : 2,
      videoCodec: caps.negotiatedCodec || 'avc1.4d002a',
    });
    await readyP;

    if (mixedAudio) {
      const left = new Float32Array(mixedAudio.getChannelData(0));
      const right =
        mixedAudio.numberOfChannels > 1 ? new Float32Array(mixedAudio.getChannelData(1)) : new Float32Array(left);
      const audioAck = waitMessage('audio-ack');
      worker.postMessage(
        {
          type: 'audio',
          left,
          right,
          sampleRate: mixedAudio.sampleRate,
          channels: mixedAudio.numberOfChannels,
        },
        [left.buffer, right.buffer]
      );
      await audioAck;
    }

    const spd = Math.max(0.25, jobCtx.speed || 1);
    const clipSrcDur = Math.max(0.1, jobCtx.trimE - jobCtx.trimS);
    const outDur = clipSrcDur / spd;
    const totalFrames = Math.max(1, Math.round(outDur * fps));

    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled?.()) {
        worker.postMessage({ type: 'abort' });
        throw new Error('Export cancelled');
      }
      if (workerErr) throw workerErr;

      const outTime = i / fps;
      const srcTime = Math.min(jobCtx.trimE, jobCtx.trimS + outTime * spd);
      await seekEl(jobV, srcTime);

      // Keep active video overlays frame-synced accurately
      for (const o of jobCtx.mediaOverlays || []) {
        const node = jobCtx.mediaNodes?.get(o.id)?.el;
        if (node?.tagName === 'VIDEO') {
          const st = Number(o.start) || 0;
          const en = Number.isFinite(+o.end) ? +o.end : jobCtx.dur;
          if (srcTime >= st && srcTime <= en) {
            const ovDur = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : 0;
            const rel = Math.max(0, srcTime - st);
            await seekEl(node, o.loop !== false && ovDur > 0 ? rel % ovDur : rel);
          }
        }
      }

      renderFrameFn(canvas, 1, null, jobCtx, bgCanvas, bgCtx);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(outTime * 1_000_000),
        duration: Math.round((1 / fps) * 1_000_000),
      });
      worker.postMessage(
        {
          type: 'frame',
          index: i,
          frame,
          keyFrame: i % (fps * 2) === 0,
        },
        [frame]
      );

      // Keep frame pacing ahead of worker by at most 6 frames to cap memory cleanly
      while (i - lastAck > 6 && !isCancelled?.() && !workerErr) {
        await new Promise((r) => setTimeout(r, 10));
      }

      if (i % 4 === 0 || i === totalFrames - 1) {
        const pct = Math.min(96, 8 + Math.round(((i + 1) / totalFrames) * 88));
        if (onProgress) onProgress(pct, `Encoding MP4 frame ${i + 1}/${totalFrames} · ${pct}%`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (onProgress) onProgress(98, 'Finalizing MP4 container…');
    const doneP = waitMessage('done');
    worker.postMessage({ type: 'finish' });
    const doneMsg = await doneP;
    return new Blob([doneMsg.buffer], { type: 'video/mp4' });
  } finally {
    jobCtx.LW = origLW;
    jobCtx.LH = origLH;
    try { worker.terminate(); } catch {}
  }
}
