import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * Dedicated WebCodecs MP4 Encoding & Muxing Worker.
 * Runs VideoEncoder + AudioEncoder + mp4-muxer completely off the main UI thread
 * so video frame encoding and MP4 interleaving never freeze timeline editing.
 */
let muxer = null;
let target = null;
let vEncoder = null;
let aEncoder = null;
let aborted = false;

async function cleanup() {
  try { await vEncoder?.flush?.(); } catch {}
  try { vEncoder?.close?.(); } catch {}
  try { await aEncoder?.flush?.(); } catch {}
  try { aEncoder?.close?.(); } catch {}
  vEncoder = null;
  aEncoder = null;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      aborted = false;
      const { width, height, fps, videoBitrate, hasAudio, sampleRate = 48000, channels = 2, videoCodec = 'avc1.4d002a' } = msg;
      target = new ArrayBufferTarget();
      muxer = new Muxer({
        target,
        video: { codec: 'avc', width, height },
        audio: hasAudio ? { codec: 'aac', numberOfChannels: channels, sampleRate } : undefined,
        fastStart: 'in-memory',
      });

      vEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer?.addVideoChunk(chunk, meta),
        error: (err) => self.postMessage({ type: 'error', message: err?.message || 'VideoEncoder error' }),
      });
      vEncoder.configure({
        codec: videoCodec,
        width,
        height,
        bitrate: videoBitrate || 8_000_000,
        framerate: fps || 30,
      });

      if (hasAudio && typeof AudioEncoder !== 'undefined') {
        aEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer?.addAudioChunk(chunk, meta),
          error: (err) => self.postMessage({ type: 'error', message: err?.message || 'AudioEncoder error' }),
        });
        aEncoder.configure({
          codec: 'mp4a.40.2',
          numberOfChannels: channels,
          sampleRate,
          bitrate: 192_000,
        });
      }
      self.postMessage({ type: 'ready' });
      return;
    }

    if (msg.type === 'frame') {
      if (aborted || !vEncoder) {
        msg.frame?.close?.();
        return;
      }
      // Backpressure control so GPU encoder queue stays bounded cleanly
      while (vEncoder.encodeQueueSize > 8 && !aborted) {
        await new Promise((r) => setTimeout(r, 8));
      }
      if (!aborted) {
        vEncoder.encode(msg.frame, { keyFrame: !!msg.keyFrame });
      }
      msg.frame.close();
      self.postMessage({ type: 'frame-ack', index: msg.index });
      return;
    }

    if (msg.type === 'audio') {
      if (aborted || !aEncoder) return;
      const { left, right, sampleRate, channels } = msg;
      const chunkFrames = 2048;
      const total = left.length;
      for (let off = 0; off < total && !aborted; off += chunkFrames) {
        const len = Math.min(chunkFrames, total - off);
        const planar = new Float32Array(len * channels);
        planar.set(left.subarray(off, off + len), 0);
        if (channels > 1 && right) planar.set(right.subarray(off, off + len), len);
        const ad = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: len,
          numberOfChannels: channels,
          timestamp: Math.round((off / sampleRate) * 1_000_000),
          data: planar,
        });
        aEncoder.encode(ad);
        ad.close();
      }
      self.postMessage({ type: 'audio-ack' });
      return;
    }

    if (msg.type === 'finish') {
      if (aborted) return;
      await vEncoder?.flush();
      await aEncoder?.flush?.();
      muxer.finalize();
      const buffer = target.buffer;
      await cleanup();
      muxer = null;
      target = null;
      self.postMessage({ type: 'done', buffer }, [buffer]);
      return;
    }

    if (msg.type === 'abort') {
      aborted = true;
      await cleanup();
      muxer = null;
      target = null;
      self.postMessage({ type: 'aborted' });
    }
  } catch (err) {
    await cleanup();
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
