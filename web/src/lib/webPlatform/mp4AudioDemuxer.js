/**
 * Lightweight, zero-dependency streaming MP4/MOV audio track extractor.
 * Uses File.slice() to read only container metadata (`moov`) and audio sample byte ranges,
 * avoiding full-file RAM loads and mobile `AudioContext.decodeAudioData()` failures on MP4/MOV video.
 */

const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function readU32(dv, off) {
  return dv.getUint32(off, false);
}

function readU64(dv, off) {
  const hi = dv.getUint32(off, false);
  const lo = dv.getUint32(off + 4, false);
  return hi * 4294967296 + lo;
}

function boxType(u8, off) {
  return String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
}

function iterBoxes(u8, start, end) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const boxes = [];
  let p = start;
  while (p + 8 <= end) {
    let size = readU32(dv, p);
    const type = boxType(u8, p + 4);
    let hdr = 8;
    if (size === 1 && p + 16 <= end) {
      size = readU64(dv, p + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < hdr || p + size > end) break;
    boxes.push({ type, start: p, dataStart: p + hdr, end: p + size });
    p += size;
  }
  return boxes;
}

function findBox(u8, start, end, path) {
  let curStart = start;
  let curEnd = end;
  let found = null;
  for (const name of path) {
    const list = iterBoxes(u8, curStart, curEnd);
    found = list.find((b) => b.type === name);
    if (!found) return null;
    curStart = found.dataStart;
    curEnd = found.end;
  }
  return found;
}

async function readMoovBuffer(file) {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const hdrBuf = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
    if (hdrBuf.length < 8) break;
    const dv = new DataView(hdrBuf.buffer);
    let size = readU32(dv, 0);
    const type = boxType(hdrBuf, 4);
    let hdr = 8;
    if (size === 1 && hdrBuf.length >= 16) {
      size = readU64(dv, 8);
      hdr = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (size < hdr) break;
    if (type === 'moov') {
      const moovU8 = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
      return moovU8;
    }
    offset += size;
  }
  return null;
}

function parseEsdsConfig(u8, start, end) {
  // Scan for DecoderSpecificInfo tag (0x05) inside esds
  for (let i = start; i + 4 < end; i++) {
    if (u8[i] === 0x05) {
      let j = i + 1;
      let len = 0;
      for (let k = 0; k < 4 && j < end; k++) {
        const b = u8[j++];
        len = (len << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) break;
      }
      if (len >= 2 && j + 1 < end) {
        const b0 = u8[j];
        const b1 = u8[j + 1];
        const objType = (b0 >> 3) & 0x1f;
        const freqIdx = ((b0 & 0x07) << 1) | ((b1 >> 7) & 0x01);
        const channels = (b1 >> 3) & 0x0f;
        if (objType > 0 && freqIdx < ADTS_RATES.length && channels > 0) {
          return { objType, freqIdx, channels, sampleRate: ADTS_RATES[freqIdx] };
        }
      }
    }
  }
  return null;
}

function parseAudioTrackFromMoov(moovU8) {
  const moovBoxes = iterBoxes(moovU8, 8, moovU8.length);
  for (const trak of moovBoxes.filter((b) => b.type === 'trak')) {
    const hdlr = findBox(moovU8, trak.dataStart, trak.end, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end) continue;
    const handlerType = boxType(moovU8, hdlr.dataStart + 8);
    if (handlerType !== 'soun') continue;

    const mdhd = findBox(moovU8, trak.dataStart, trak.end, ['mdia', 'mdhd']);
    if (!mdhd) continue;
    const mdDv = new DataView(moovU8.buffer, moovU8.byteOffset + mdhd.dataStart, mdhd.end - mdhd.dataStart);
    const mdVer = mdDv.getUint8(0);
    const timescale = mdVer === 1 ? readU32(mdDv, 20) : readU32(mdDv, 12);

    const stbl = findBox(moovU8, trak.dataStart, trak.end, ['mdia', 'minf', 'stbl']);
    if (!stbl) continue;

    const stsd = findBox(moovU8, stbl.dataStart, stbl.end, ['stsd']);
    if (!stsd || stsd.dataStart + 16 > stsd.end) continue;
    const entryBoxes = iterBoxes(moovU8, stsd.dataStart + 8, stsd.end);
    const mp4a = entryBoxes.find((b) => b.type === 'mp4a');
    if (!mp4a || mp4a.dataStart + 28 > mp4a.end) continue;

    const mp4aDv = new DataView(moovU8.buffer, moovU8.byteOffset + mp4a.dataStart, mp4a.end - mp4a.dataStart);
    const fallbackCh = mp4aDv.getUint16(16, false) || 2;
    const fallbackSr = mp4aDv.getUint16(24, false) || timescale || 44100;
    const esds = iterBoxes(moovU8, mp4a.dataStart + 28, mp4a.end).find((b) => b.type === 'esds');
    let audioCfg = esds ? parseEsdsConfig(moovU8, esds.dataStart, esds.end) : null;
    if (!audioCfg) {
      let fi = ADTS_RATES.indexOf(fallbackSr);
      if (fi < 0) fi = 4; // 44100
      audioCfg = { objType: 2, freqIdx: fi, channels: Math.min(7, fallbackCh), sampleRate: ADTS_RATES[fi] };
    }

    // Parse sample sizes (stsz)
    const stsz = findBox(moovU8, stbl.dataStart, stbl.end, ['stsz']);
    if (!stsz) continue;
    const szDv = new DataView(moovU8.buffer, moovU8.byteOffset + stsz.dataStart, stsz.end - stsz.dataStart);
    const uniformSize = readU32(szDv, 4);
    const sampleCount = readU32(szDv, 8);
    if (!sampleCount) continue;
    const sampleSizes = new Uint32Array(sampleCount);
    if (uniformSize > 0) {
      sampleSizes.fill(uniformSize);
    } else {
      for (let i = 0; i < sampleCount; i++) sampleSizes[i] = readU32(szDv, 12 + i * 4);
    }

    // Parse chunk offsets (stco or co64)
    const stco = findBox(moovU8, stbl.dataStart, stbl.end, ['stco']);
    const co64 = !stco ? findBox(moovU8, stbl.dataStart, stbl.end, ['co64']) : null;
    if (!stco && !co64) continue;
    const chunkOffsets = [];
    if (stco) {
      const dv = new DataView(moovU8.buffer, moovU8.byteOffset + stco.dataStart, stco.end - stco.dataStart);
      const cnt = readU32(dv, 4);
      for (let i = 0; i < cnt; i++) chunkOffsets.push(readU32(dv, 8 + i * 4));
    } else {
      const dv = new DataView(moovU8.buffer, moovU8.byteOffset + co64.dataStart, co64.end - co64.dataStart);
      const cnt = readU32(dv, 4);
      for (let i = 0; i < cnt; i++) chunkOffsets.push(readU64(dv, 8 + i * 8));
    }

    // Parse sample-to-chunk (stsc)
    const stsc = findBox(moovU8, stbl.dataStart, stbl.end, ['stsc']);
    if (!stsc) continue;
    const scDv = new DataView(moovU8.buffer, moovU8.byteOffset + stsc.dataStart, stsc.end - stsc.dataStart);
    const scCnt = readU32(scDv, 4);
    const stscEntries = [];
    for (let i = 0; i < scCnt; i++) {
      stscEntries.push({
        firstChunk: readU32(scDv, 8 + i * 12),
        samplesPerChunk: readU32(scDv, 12 + i * 12),
      });
    }

    // Parse sample durations (stts)
    const stts = findBox(moovU8, stbl.dataStart, stbl.end, ['stts']);
    const tsDv = stts ? new DataView(moovU8.buffer, moovU8.byteOffset + stts.dataStart, stts.end - stts.dataStart) : null;
    const tsCnt = tsDv ? readU32(tsDv, 4) : 0;
    const sttsEntries = [];
    for (let i = 0; i < tsCnt; i++) {
      sttsEntries.push({ count: readU32(tsDv, 8 + i * 8), delta: readU32(tsDv, 12 + i * 8) });
    }

    // Build flat sample table: { offset, size, startSec, durSec }
    const samples = new Array(sampleCount);
    let sIdx = 0;
    let scIdx = 0;
    for (let c = 0; c < chunkOffsets.length && sIdx < sampleCount; c++) {
      const chunkNum = c + 1;
      while (scIdx + 1 < stscEntries.length && chunkNum >= stscEntries[scIdx + 1].firstChunk) scIdx++;
      const nInChunk = stscEntries[scIdx]?.samplesPerChunk || 1;
      let fileOff = chunkOffsets[c];
      for (let k = 0; k < nInChunk && sIdx < sampleCount; k++) {
        const size = sampleSizes[sIdx];
        samples[sIdx] = { offset: fileOff, size, startSec: 0, durSec: 0 };
        fileOff += size;
        sIdx++;
      }
    }

    let tsPos = 0;
    let tsRem = sttsEntries[0]?.count || sampleCount;
    let curDelta = sttsEntries[0]?.delta || 1024;
    let accTicks = 0;
    const scale = timescale || audioCfg.sampleRate || 44100;
    for (let i = 0; i < sampleCount; i++) {
      while (tsRem <= 0 && tsPos + 1 < sttsEntries.length) {
        tsPos++;
        tsRem = sttsEntries[tsPos].count;
        curDelta = sttsEntries[tsPos].delta;
      }
      samples[i].startSec = accTicks / scale;
      samples[i].durSec = curDelta / scale;
      accTicks += curDelta;
      tsRem--;
    }

    return { audioCfg, samples, duration: accTicks / scale };
  }
  return null;
}

function buildAdtsChunk(samplesSlice, rawChunksBytes, baseOffset, audioCfg) {
  const { objType, freqIdx, channels } = audioCfg;
  const profile = Math.max(0, (objType || 2) - 1);
  let totalBytes = 0;
  for (const s of samplesSlice) totalBytes += 7 + s.size;
  const out = new Uint8Array(totalBytes);
  let pos = 0;

  for (const s of samplesSlice) {
    const frameLen = 7 + s.size;
    out[pos] = 0xff;
    out[pos + 1] = 0xf1;
    out[pos + 2] = ((profile & 0x03) << 6) | ((freqIdx & 0x0f) << 2) | ((channels >> 2) & 0x01);
    out[pos + 3] = ((channels & 0x03) << 6) | ((frameLen >> 11) & 0x03);
    out[pos + 4] = (frameLen >> 3) & 0xff;
    out[pos + 5] = ((frameLen & 0x07) << 5) | 0x1f;
    out[pos + 6] = 0xfc;
    pos += 7;
    const rel = s.offset - baseOffset;
    out.set(rawChunksBytes.subarray(rel, rel + s.size), pos);
    pos += s.size;
  }
  return out;
}

/**
 * Extracts AAC audio chunks with ADTS headers directly from an MP4/MOV/M4V/M4A file
 * without decoding full video or loading the full file into memory.
 */
export async function extractMp4AacChunks(file, onProgress, { chunkSec = 105, overlapSec = 4 } = {}) {
  if (onProgress) onProgress(8, 'Reading MP4 audio track index…');
  const moov = await readMoovBuffer(file);
  if (!moov) return null;
  const parsed = parseAudioTrackFromMoov(moov);
  if (!parsed || !parsed.samples.length) return null;

  const { audioCfg, samples, duration } = parsed;
  const chunks = [];
  let startIdx = 0;

  while (startIdx < samples.length) {
    const startSec = samples[startIdx].startSec;
    const targetEndSec = startSec + chunkSec;
    let endIdx = startIdx;
    let chunkBytesSum = 0;
    // Cap at ~2.8 MB raw audio per chunk so base64 stays safely under 4.2 MB Vercel cap
    while (endIdx < samples.length && samples[endIdx].startSec < targetEndSec && chunkBytesSum + samples[endIdx].size < 2_800_000) {
      chunkBytesSum += samples[endIdx].size + 7;
      endIdx++;
    }
    if (endIdx === startIdx) endIdx = startIdx + 1;

    const slice = samples.slice(startIdx, endIdx);
    const minOff = slice[0].offset;
    const maxEnd = slice[slice.length - 1].offset + slice[slice.length - 1].size;
    // Read contiguous range from minOff..maxEnd via File.slice (interleaved video+audio is typically <= 12-20 MB per 100s)
    // If span > 24 MB (very high bitrate 4K video), read each sample individually to stay tiny in mobile RAM!
    let aacBytes;
    if (maxEnd - minOff <= 24 * 1024 * 1024) {
      const raw = new Uint8Array(await file.slice(minOff, maxEnd).arrayBuffer());
      aacBytes = buildAdtsChunk(slice, raw, minOff, audioCfg);
    } else {
      let total = 0;
      for (const s of slice) total += 7 + s.size;
      aacBytes = new Uint8Array(total);
      let pos = 0;
      const profile = Math.max(0, (audioCfg.objType || 2) - 1);
      for (const s of slice) {
        const frameLen = 7 + s.size;
        aacBytes[pos] = 0xff;
        aacBytes[pos + 1] = 0xf1;
        aacBytes[pos + 2] = ((profile & 0x03) << 6) | ((audioCfg.freqIdx & 0x0f) << 2) | ((audioCfg.channels >> 2) & 0x01);
        aacBytes[pos + 3] = ((audioCfg.channels & 0x03) << 6) | ((frameLen >> 11) & 0x03);
        aacBytes[pos + 4] = (frameLen >> 3) & 0xff;
        aacBytes[pos + 5] = ((frameLen & 0x07) << 5) | 0x1f;
        aacBytes[pos + 6] = 0xfc;
        pos += 7;
        const sb = new Uint8Array(await file.slice(s.offset, s.offset + s.size).arrayBuffer());
        aacBytes.set(sb, pos);
        pos += s.size;
      }
    }

    const lastSample = slice[slice.length - 1];
    const chunkDur = Math.max(0.1, lastSample.startSec + lastSample.durSec - startSec);
    chunks.push({
      startOffsetSec: startSec,
      durationSec: chunkDur,
      overlapSec: startIdx > 0 ? overlapSec : 0,
      mimeType: 'audio/m4a',
      wavBytes: aacBytes,
    });

    if (endIdx >= samples.length) break;
    const nextTargetSec = Math.max(startSec + 1, lastSample.startSec - overlapSec);
    let nextIdx = endIdx;
    while (nextIdx > startIdx + 1 && samples[nextIdx - 1].startSec > nextTargetSec) nextIdx--;
    startIdx = nextIdx;
  }

  if (onProgress) onProgress(26, `Extracted ${chunks.length} lightweight AAC audio chunk(s)`);
  return { duration, chunks };
}
