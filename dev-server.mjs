import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = fs.existsSync(path.join(DIST_DIR, 'index.html')) ? DIST_DIR : path.join(__dirname, 'src');
const TAURI_DIR = path.join(__dirname, 'src-tauri');
const PORT = Number(process.env.PORT) || 4173;
const OVR_FILE = path.join(os.tmpdir(), 'ics_dev_overrides.json');

let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(OVR_FILE, 'utf8')); } catch {}

const sseClients = new Set();
function emit(event, payload) {
  const data = JSON.stringify({ event, payload });
  for (const res of sseClients) {
    try { res.write(`data: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function ovr(k) {
  const v = overrides[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function localApp() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'InstaClipStudio');
}

function findBin(name) {
  if (ovr(name) && fs.existsSync(ovr(name))) return ovr(name);
  const dirs = [path.join(localApp(), 'tools'), __dirname, TAURI_DIR];
  for (const d of dirs) {
    for (const n of [`${name}.exe`, name]) {
      const p = path.join(d, n);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  const res = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout) {
    const first = res.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

function findPython() {
  const candidates = [];
  if (ovr('python')) candidates.push([ovr('python'), []]);
  candidates.push(['python', []], ['py', ['-3']], ['python3', []]);
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return [cmd, pre];
  }
  return null;
}

function pyHas(py, mod) {
  if (!py) return false;
  const r = spawnSync(py[0], [...py[1], '-c', `import importlib.util as u,sys;sys.exit(0 if u.find_spec('${mod}') else 1)`]);
  return r.status === 0;
}

function probeDuration(filePath) {
  const ffprobe = findBin('ffprobe');
  if (!ffprobe) return null;
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function runProcess(cmd, args, { env, onStdoutLine, onStderrLine } = {}) {
  return new Promise((resolve, reject) => {
    const ch = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let outBuf = '', errBuf = '';
    ch.stdout.on('data', d => {
      outBuf += d.toString();
      const lines = outBuf.split(/\r?\n/);
      outBuf = lines.pop();
      lines.forEach(l => onStdoutLine?.(l));
    });
    ch.stderr.on('data', d => {
      errBuf += d.toString();
      const lines = errBuf.split(/\r?\n/);
      errBuf = lines.pop();
      lines.forEach(l => onStderrLine?.(l));
    });
    ch.on('error', reject);
    ch.on('close', code => {
      if (outBuf) onStdoutLine?.(outBuf);
      if (errBuf) onStderrLine?.(errBuf);
      resolve(code ?? 1);
    });
  });
}

function elevenLabsWordsToSegments(words, fallbackText, totalDuration, tagAudioEvents, maxWords = 8) {
  const tokens = [];
  for (const item of words || []) {
    const kind = item.type || 'word';
    if (kind === 'spacing') continue;
    if (kind === 'audio_event' && !tagAudioEvents) continue;
    const text = String(item.text || '').trim();
    if (!text) continue;
    const s = Number(item.start) || 0;
    const e = Math.max(s + 0.02, Number(item.end) || s + 0.2);
    tokens.push({ s, e, t: text, spk: item.speaker_id || '' });
  }
  if (!tokens.length) {
    const txt = String(fallbackText || '').trim();
    return txt ? [{ s: 0, e: totalDuration || 5, t: txt }] : [];
  }
  const endRe = /[.!?؟۔…;؛।]$/;
  const segs = [];
  let cur = [];
  const wordLimit = maxWords > 0 ? maxWords : 8;
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      s: cur[0].s,
      e: cur[cur.length - 1].e,
      t: cur.map(x => x.t).join(' '),
      w: cur.map(x => ({ w: x.t, s: x.s, e: x.e })),
    });
    cur = [];
  };
  for (const tok of tokens) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = Math.max(0, tok.s - prev.e);
      const spkChanged = prev.spk && tok.spk && prev.spk !== tok.spk;
      const curDur = tok.e - cur[0].s;
      const curChars = cur.reduce((n, x) => n + x.t.length + 1, 0);
      if (endRe.test(prev.t) || spkChanged || gap >= 0.75 || cur.length >= wordLimit || curChars >= 110 || curDur >= 8.0) {
        flush();
      }
    }
    cur.push(tok);
  }
  flush();
  return segs;
}

function groqWordsToSegments(words, fallbackText, maxWords = 12) {
  if (!words || !words.length) {
    const txt = String(fallbackText || '').trim();
    return txt ? [{ s: 0, e: 4, t: txt, w: [] }] : [];
  }
  const segs = [];
  let cur = [];
  const limit = Math.max(4, Math.min(18, maxWords || 12));
  const endRe = /[.!?؟۔…]$/;
  const flush = () => {
    if (!cur.length) return;
    segs.push({
      s: cur[0].s,
      e: cur[cur.length - 1].e,
      t: cur.map(x => x.w).join(' ').trim(),
      w: cur.map(x => ({ w: x.w, s: x.s, e: x.e })),
    });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = Math.max(0, w.s - prev.e);
      if (endRe.test(prev.w) || gap >= 0.85 || cur.length >= limit) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();
  return segs;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleInvoke(cmd, req, res) {
  const raw = await readBody(req);
  if (cmd === 'write_file' || cmd === 'append_file') {
    const target = decodeURIComponent(req.headers['x-path'] || '');
    if (!target) throw new Error('Missing x-path header');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (cmd === 'write_file') fs.writeFileSync(target, raw);
    else fs.appendFileSync(target, raw);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('null');
    return;
  }
  if (cmd === 'upload_temp') {
    const name = decodeURIComponent(req.headers['x-name'] || 'upload.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const dest = path.join(os.tmpdir(), `ics_dev_${Date.now()}_${name}`);
    fs.writeFileSync(dest, raw);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: dest }));
    return;
  }
  const args = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  if (cmd === 'read_file') {
    const buf = fs.readFileSync(args.path);
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(buf);
    return;
  }

  let result;
  switch (cmd) {
    case 'set_overrides':
      overrides = { ...(args.map || {}) };
      try { fs.writeFileSync(OVR_FILE, JSON.stringify(overrides)); } catch {}
      result = null;
      break;
    case 'env_check': {
      const py = findPython();
      const ff = findBin('ffmpeg');
      const yt = findBin('yt-dlp');
      let pkgs = {};
      if (py) {
        const r = spawnSync(py[0], [...py[1], path.join(TAURI_DIR, 'env_check.py')], { encoding: 'utf8' });
        try { pkgs = JSON.parse(r.stdout || '{}'); } catch {}
      }
      result = JSON.stringify({
        cohere: { runtime: false, version: '', models: [], token: !!ovr('hf_token') },
        elevenlabs: { key: !!ovr('elevenlabs_key') },
        python: { ok: !!py, version: py ? spawnSync(py[0], [...py[1], '--version'], { encoding: 'utf8' }).stdout.trim() : null },
        pkgs,
        yt_dlp: { ok: !!yt || pkgs.yt_dlp === true, path: yt, module: pkgs.yt_dlp === true },
        ffmpeg: { ok: !!ff, path: ff, source: ff ? 'system/tools' : null },
        whispercpp: { ok: !!findBin('whisper-cli'), path: findBin('whisper-cli') },
        fw_models: [], cpp_models: [], demucs_weights: false, tools_dir: path.join(localApp(), 'tools'),
      });
      break;
    }
    case 'test_elevenlabs': {
      const key = (args.key || '').trim() || ovr('elevenlabs_key');
      if (!key) throw new Error('Add your ElevenLabs API key first.');
      const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail?.message || j?.detail || `ElevenLabs HTTP ${r.status}`);
      result = j.character_limit != null ? `Connected (${j.tier || 'active'} · ${j.character_count}/${j.character_limit} chars)` : `Connected (${j.tier || 'active'})`;
      break;
    }
    case 'media_duration': {
      const d = probeDuration(args.path);
      if (!d) throw new Error(`Could not determine duration: ${args.path}`);
      result = d;
      break;
    }
    case 'ensure_dir':
      fs.mkdirSync(args.path, { recursive: true });
      result = null;
      break;
    case 'copy_file':
      fs.mkdirSync(path.dirname(args.destination), { recursive: true });
      if (args.source !== args.destination) fs.copyFileSync(args.source, args.destination);
      result = null;
      break;
    case 'reveal':
      if (process.platform === 'win32' && args.path) {
        spawn('explorer', [fs.existsSync(args.path) && fs.statSync(args.path).isFile() ? `/select,${args.path}` : args.path], { detached: true, stdio: 'ignore' }).unref();
      }
      result = null;
      break;
    case 'ytdlp_version': {
      const yt = findBin('yt-dlp');
      if (!yt) throw new Error('yt-dlp not found');
      const r = spawnSync(yt, ['--version'], { encoding: 'utf8' });
      result = (r.stdout || '').trim();
      break;
    }
    case 'ytdlp_download': {
      const yt = findBin('yt-dlp');
      if (!yt) throw new Error('yt-dlp not found on this PC');
      const dir = args.dir || path.join(os.homedir(), 'Downloads');
      const sel = args.fmt === '1080' ? 'bv*[height<=1080]+ba/b[height<=1080]' : args.fmt === '720' ? 'bv*[height<=720]+ba/b[height<=720]' : args.fmt === 'audio' ? 'ba/b' : 'bv*+ba/b';
      const extra = args.fmt === 'audio' ? ['-x', '--audio-format', 'mp3'] : ['--merge-output-format', 'mp4'];
      const ff = findBin('ffmpeg');
      const yArgs = ['--newline', '--no-playlist', '--no-quiet', '--progress', '-f', sel, '-P', dir, '-o', '%(title).80s [%(id)s].%(ext)s', '--print', 'after_move:filepath'];
      if (ff) yArgs.push('--ffmpeg-location', ff);
      yArgs.push(...extra, args.url);
      let lastPath = '';
      const code = await runProcess(yt, yArgs, {
        onStdoutLine: l => { if (!l.startsWith('[') && l.trim()) lastPath = l.trim(); emit('ytdlp-log', l); },
        onStderrLine: l => emit('ytdlp-log', l),
      });
      if (code !== 0 || !lastPath) throw new Error(`yt-dlp exited with code ${code}`);
      result = lastPath;
      break;
    }
    case 'transcribe': {
      const ff = findBin('ffmpeg');
      if (!ff) throw new Error('FFmpeg not found. Install FFmpeg or add it to PATH.');
      const total = args.durationHint || probeDuration(args.input) || 0;
      emit('whisper-log', 'extract-progress=0%');
      if (args.engine === 'groq') {
        const key = (args.groqKey || '').trim() || ovr('groq_key');
        if (!key) throw new Error('Add your Groq API key first in Auto Subtitles or Settings.');
        const modelId = args.model === 'whisper-large-v3-turbo' ? 'whisper-large-v3-turbo' : 'whisper-large-v3';
        const chunkSec = 120;
        const overlapSec = 3.5;
        const totalDur = total || probeDuration(args.input) || 120;
        const numChunks = Math.max(1, Math.ceil(totalDur / (chunkSec - overlapSec)));

        const allWords = [];
        const allTexts = [];
        const failedChunks = [];

        for (let ci = 0; ci < numChunks; ci++) {
          const startSec = ci === 0 ? 0 : Math.max(0, ci * (chunkSec - overlapSec));
          const chunkMp3 = path.join(os.tmpdir(), `ics_dev_groq_${Date.now()}_${ci}.mp3`);
          emit('whisper-log', `phase=uploading-groq:${ci + 1}/${numChunks}`);

          const exCode = await runProcess(ff, [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-ss', String(startSec), '-t', String(chunkSec),
            '-i', args.input, '-vn', '-ac', '1', '-ar', '16000',
            '-c:a', 'libmp3lame', '-b:a', '64k', chunkMp3
          ]);

          if (exCode !== 0 || !fs.existsSync(chunkMp3) || fs.statSync(chunkMp3).size < 100) {
            try { fs.unlinkSync(chunkMp3); } catch {}
            if (ci > 0 && startSec >= totalDur - 1) break;
            failedChunks.push(`Chunk ${ci + 1} extraction failed`);
            continue;
          }

          const rollingPrompt = [
            (args.prompt || '').slice(0, 200),
            allWords.slice(-16).map(w => w.w).join(' ')
          ].filter(Boolean).join('. ').slice(0, 400);

          let parsed = null;
          let lastErr = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const form = new FormData();
              form.append('file', new Blob([fs.readFileSync(chunkMp3)], { type: 'audio/mpeg' }), 'audio.mp3');
              form.append('model', modelId);
              form.append('response_format', 'verbose_json');
              form.append('timestamp_granularities[]', 'word');
              form.append('timestamp_granularities[]', 'segment');
              form.append('temperature', '0');
              if (args.lang && args.lang !== 'auto') form.append('language', args.lang);
              if (rollingPrompt) form.append('prompt', rollingPrompt);

              const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { authorization: `Bearer ${key}` },
                body: form
              });
              const j = await resp.json().catch(() => ({}));
              if (resp.ok) {
                parsed = j;
                break;
              }
              lastErr = j?.error?.message || `Groq HTTP ${resp.status}`;
            } catch (err) {
              lastErr = err?.message || String(err);
            }
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }

          try { fs.unlinkSync(chunkMp3); } catch {}

          if (!parsed) {
            failedChunks.push(`Chunk ${ci + 1}: ${lastErr}`);
            continue;
          }

          const rawWords = (parsed.words || []).map(w => ({
            w: String(w.word ?? w.text ?? '').trim(),
            s: Number(w.start || 0) + startSec,
            e: Math.max(Number(w.start || 0) + startSec + 0.04, Number(w.end || 0) + startSec)
          })).filter(w => w.w);

          if (allWords.length && rawWords.length) {
            const overlapCutoff = startSec + overlapSec * 0.5;
            const keptExisting = allWords.filter(w => w.s < overlapCutoff);
            const keptIncoming = rawWords.filter(w => w.s >= overlapCutoff);
            allWords.length = 0;
            allWords.push(...keptExisting, ...keptIncoming);
          } else {
            allWords.push(...rawWords);
          }

          if (parsed.text) allTexts.push(parsed.text.trim());
        }

        if (!allWords.length && failedChunks.length) {
          throw new Error('Groq transcription failed: ' + failedChunks.join('; '));
        }

        emit('whisper-log', 'progress = 100%');
        const segs = groqWordsToSegments(allWords, allTexts.join(' '), args.maxWords ?? 12);
        result = JSON.stringify({ segments: segs, words: allWords, engine: 'groq', model: modelId, failed_chunks: failedChunks });
        break;
      }
      if (args.engine === 'elevenlabs') {
        const key = (args.elevenlabsKey || '').trim() || ovr('elevenlabs_key');
        if (!key) throw new Error('Add your ElevenLabs API key first.');
        const modelId = args.model === 'scribe_v1' ? 'scribe_v1' : 'scribe_v2';
        const mp3 = path.join(os.tmpdir(), `ics_dev_el_${Date.now()}.mp3`);
        const code = await runProcess(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', args.input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '-progress', 'pipe:1', '-nostats', mp3], {
          onStdoutLine: l => {
            const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
            if (m && total > 0) emit('whisper-log', `extract-progress=${Math.min(99, Math.round(Number(m[1]) / 1e6 / total * 100))}%`);
          },
        });
        if (code !== 0 || !fs.existsSync(mp3)) throw new Error('Audio extraction failed for ElevenLabs.');
        emit('whisper-log', `phase=uploading-elevenlabs:${modelId}`);
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
        form.append('model_id', modelId);
        form.append('timestamps_granularity', 'word');
        form.append('tag_audio_events', args.tagAudioEvents ? 'true' : 'false');
        form.append('diarize', args.diarize ? 'true' : 'false');
        if (args.lang && args.lang !== 'auto') form.append('language_code', args.lang);
        if (modelId === 'scribe_v2' && args.prompt) {
          args.prompt.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).slice(0, 100).forEach(t => form.append('keyterms', t.slice(0, 50)));
        }
        const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
        try { fs.unlinkSync(mp3); } catch {}
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.detail?.message || j?.detail || `ElevenLabs HTTP ${resp.status}`);
        emit('whisper-log', 'progress = 100%');
        const segs = elevenLabsWordsToSegments(j.words || [], j.text || '', total, !!args.tagAudioEvents, args.maxWords ?? 8);
        result = JSON.stringify({ segments: segs, engine: 'elevenlabs', model: modelId, language_code: j.language_code || '' });
        break;
      }
      const py = findPython();
      if (!py || !pyHas(py, 'faster_whisper')) throw new Error('faster-whisper not found in Python. Use ElevenLabs Scribe 2 or install faster-whisper.');
      const wav = path.join(os.tmpdir(), `ics_dev_w_${Date.now()}.wav`);
      const outj = path.join(os.tmpdir(), `ics_dev_out_${Date.now()}.json`);
      const argf = path.join(os.tmpdir(), `ics_dev_args_${Date.now()}.json`);
      const exCode = await runProcess(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', args.input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      if (exCode !== 0) throw new Error('FFmpeg audio extraction failed.');
      emit('whisper-log', 'phase=loading-model');
      fs.writeFileSync(argf, JSON.stringify({ audio: wav, out: outj, model: args.model || 'auto', lang: args.lang, maxlen: args.maxlen || 0, max_words: args.maxWords ?? 8, prompt: args.prompt || '', ctx: !!args.ctx, det: !!args.det, translate: !!args.translate }));
      const wCode = await runProcess(py[0], [...py[1], path.join(TAURI_DIR, 'whisper_run.py'), argf], {
        env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        onStdoutLine: l => emit('whisper-log', l),
        onStderrLine: l => emit('whisper-log', l),
      });
      try { fs.unlinkSync(wav); fs.unlinkSync(argf); } catch {}
      if (wCode !== 0 || !fs.existsSync(outj)) throw new Error(`faster-whisper failed with code ${wCode}`);
      const segs = JSON.parse(fs.readFileSync(outj, 'utf8'));
      try { fs.unlinkSync(outj); } catch {}
      result = JSON.stringify({ segments: segs });
      break;
    }
    case 'finalize_export': {
      const ff = findBin('ffmpeg');
      if (!ff) throw new Error('FFmpeg not found.');
      const workDir = path.dirname(args.out);
      fs.mkdirSync(workDir, { recursive: true });
      const wav = path.join(workDir, 'audio_work.wav');
      const baseAudio = (args.audioSource || '').trim() || args.source;
      const src = (args.pre || '').trim() || baseAudio;
      const speed = Number.isFinite(args.speed) && args.speed >= 0.5 && args.speed <= 2.0 ? args.speed : 1.0;
      const chain = [];
      if (Math.abs(speed - 1) > 0.001) chain.push(`atempo=${speed}`);
      if (args.enhance) {
        if (!(args.pre || '').trim()) chain.push('adeclip,highpass=f=80,afftdn=nr=12:nf=-35,equalizer=f=250:width_type=q:width=1:g=-2,equalizer=f=3500:width_type=q:width=1:g=2.5,highshelf=f=9000:g=2');
        chain.push('acompressor=threshold=0.125:ratio=3:attack=10:release=150:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11');
      }
      const aArgs = ['-y', '-ss', String(args.start), '-t', String(args.dur), '-i', src, '-vn', '-ac', '2', '-ar', '44100'];
      if (chain.length) aArgs.push('-af', chain.join(','));
      aArgs.push(wav);
      if (await runProcess(ff, aArgs) !== 0) throw new Error('FFmpeg audio processing failed.');
      const totalSec = args.dur / speed;
      const eCode = await runProcess(ff, ['-y', '-progress', 'pipe:1', '-nostats', '-i', args.video, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=30', '-c:v', 'libx264', '-crf', String(args.crf || 19), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-af', 'alimiter=limit=0.97', '-shortest', '-movflags', '+faststart', args.out], {
        onStdoutLine: l => {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(l);
          if (m && totalSec > 0) emit('export-log', `Encoding video (libx264)… ${Math.min(99, Math.round(Number(m[1]) / 1e6 / totalSec * 100))}%`);
          else if (l === 'progress=end') emit('export-log', 'Encoding video (libx264)… 100%');
        },
      });
      try { fs.unlinkSync(wav); fs.unlinkSync(args.video); } catch {}
      if (eCode !== 0) throw new Error('FFmpeg video encode failed.');
      result = args.out;
      break;
    }
    case 'make_background_video': {
      const ff = findBin('ffmpeg');
      if (!ff) throw new Error('FFmpeg not found.');
      const w = Math.floor(Math.max(320, Math.min(2160, args.width)) / 2) * 2;
      const h = Math.floor(Math.max(320, Math.min(3840, args.height)) / 2) * 2;
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      const code = await runProcess(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', args.image, '-i', args.audio, '-t', String(args.duration), '-vf', vf, '-r', '30', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', args.out]);
      if (code !== 0) throw new Error('FFmpeg failed creating timed background.');
      result = args.out;
      break;
    }
    case 'make_looped_background_video': {
      const ff = findBin('ffmpeg');
      if (!ff) throw new Error('FFmpeg not found.');
      const w = Math.floor(Math.max(320, Math.min(2160, args.width)) / 2) * 2;
      const h = Math.floor(Math.max(320, Math.min(3840, args.height)) / 2) * 2;
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
      const code = await runProcess(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-stream_loop', '-1', '-i', args.video, '-t', String(args.duration), '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.out]);
      if (code !== 0) throw new Error('FFmpeg failed looping background video.');
      result = args.out;
      break;
    }
    default:
      throw new Error(`Unsupported dev command: ${cmd}`);
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result === undefined ? null : result));
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(':\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (u.pathname === '/api/proxy' && req.method === 'POST') {
      const { url: targetUrl, method = 'GET', headers = {}, body } = JSON.parse((await readBody(req)).toString('utf8'));
      const upstream = await fetch(targetUrl, { method, headers, body });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/octet-stream' });
      res.end(buf);
      return;
    }
    if (u.pathname.startsWith('/api/invoke/')) {
      const cmd = u.pathname.slice('/api/invoke/'.length);
      await handleInvoke(cmd, req, res);
      return;
    }
    let rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(SRC_DIR, rel);
    if (!filePath.startsWith(SRC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  Insta Clip Studio — Instant Live Preview (no build needed!)`);
  console.log(`  Open in browser: ${url}\n`);
  if (!process.env.NO_OPEN && process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
