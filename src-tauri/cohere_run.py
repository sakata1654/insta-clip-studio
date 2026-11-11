# Cohere Transcribe (English / Arabic) with VAD-based timestamp reconstruction.
# Uses the model's optimized transcribe() path when available, while retaining
# VAD segment start/end times for the editor's subtitle workflow.
import sys, json, os, traceback, time
import numpy as np


def log(message):
    print(message, flush=True)


def vad_segments(audio, sr):
    try:
        from faster_whisper.vad import get_speech_timestamps, VadOptions
        ts = get_speech_timestamps(
            audio,
            VadOptions(min_silence_duration_ms=400, speech_pad_ms=500, max_speech_duration_s=20),
        )
        segs = [(t['start'] / sr, t['end'] / sr) for t in ts]
    except Exception as e:
        log(f"VAD unavailable ({type(e).__name__}: {e}); using fixed windows")
        n = len(audio) / sr
        segs = [(float(i), float(min(n, i + 15.0))) for i in np.arange(0, n, 15.0)]
    out = []
    for s, e in segs:
        if out and (s - out[-1][1] < 0.35 and e - out[-1][0] < 12.0):
            out[-1] = (out[-1][0], e)
        elif out and (e - s < 0.8 and e - out[-1][0] < 12.0):
            out[-1] = (out[-1][0], e)
        else:
            out.append((s, e))
    return out


def clean_text(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ('text', 'transcription', 'generated_text'):
            if isinstance(value.get(key), str):
                return value[key].strip()
    return str(value).strip() if value is not None else ''


def main():
    started = time.perf_counter()
    log('Reading extracted audio…')
    with open(sys.argv[1], encoding='utf-8') as f:
        a = json.load(f)
    import soundfile as sf
    audio, sr = sf.read(a['audio'], dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        # Rust currently extracts at 16 kHz; this guard also protects future callers.
        try:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000).astype(np.float32, copy=False)
        except Exception as e:
            raise RuntimeError(f'Audio must be resampled from {sr} Hz to 16000 Hz, but librosa resampling failed: {e}')
        log(f'Resampled audio from {sr} Hz to 16000 Hz')
        sr = 16000

    vad_started = time.perf_counter()
    segs = vad_segments(audio, sr)
    log(f"Audio duration: {len(audio) / sr:.1f}s; {len(segs)} speech segments; VAD {time.perf_counter()-vad_started:.1f}s")
    if not segs:
        with open(a['out'], 'w', encoding='utf-8') as f:
            json.dump([], f, ensure_ascii=False)
        log('DONE')
        return

    import torch
    from transformers import AutoProcessor, CohereAsrForConditionalGeneration
    mid = a['model_id']
    tok = os.environ.get('HF_TOKEN') or None
    if torch.cuda.is_available():
        try:
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        except Exception:
            vram_gb = 0.0
        try:
            bf16_ok = bool(torch.cuda.is_bf16_supported())
        except Exception:
            bf16_ok = False
        model_dtype = torch.bfloat16 if bf16_ok else torch.float16
        # Keep activation memory conservative on 4 GB GPUs. Larger VRAM can batch.
        batch_size = 1 if vram_gb < 6.0 else (2 if vram_gb < 10.0 else 4)
        log(f'CUDA available; VRAM {vram_gb:.1f} GB; dtype {model_dtype}; inference batch {batch_size}')
    else:
        model_dtype = torch.float32
        batch_size = 1
        log('CUDA unavailable; using CPU float32. Transcription will be substantially slower.')

    load_started = time.perf_counter()
    log(f'Loading model {mid}…')
    processor = AutoProcessor.from_pretrained(mid, token=tok)
    try:
        model = CohereAsrForConditionalGeneration.from_pretrained(
            mid, device_map='auto', token=tok, dtype=model_dtype
        )
    except TypeError:
        model = CohereAsrForConditionalGeneration.from_pretrained(mid, device_map='auto', token=tok)
    model.eval()
    log(f"MODEL {mid.split('/')[-1]} on {model.device}; load {time.perf_counter()-load_started:.1f}s")

    lang = a['lang']
    out = []
    # Accuracy-first inference: use the documented Transformers processor + generate
    # path. Do not call an assumed model.transcribe() method; it is not the documented
    # API for CohereAsrForConditionalGeneration and can behave differently across versions.
    # Batch only within the detected VRAM budget. Keep the audio_chunk_index returned by
    # the processor so any internal feature-extractor chunks are reassembled correctly.
    batch_size = max(1, batch_size)
    inference_started = time.perf_counter()
    inference_seconds = 0.0
    max_new_tokens = 512
    for i in range(0, len(segs), batch_size):
        part = segs[i:i + batch_size]
        chunks = [audio[max(0, int(s * sr)):min(len(audio), int(e * sr))] for s, e in part]
        # Do not feed empty/near-empty arrays to the processor.
        valid = [(se, c) for se, c in zip(part, chunks) if len(c) >= int(0.10 * sr)]
        if not valid:
            continue
        valid_part = [x[0] for x in valid]
        valid_chunks = [x[1] for x in valid]
        t0 = time.perf_counter()
        try:
            inputs = processor(valid_chunks, sampling_rate=sr, return_tensors='pt', language=lang)
            audio_chunk_index = inputs.get('audio_chunk_index')
            inputs.to(model.device, dtype=model.dtype)
            with torch.inference_mode():
                generated = model.generate(**inputs, max_new_tokens=max_new_tokens)
            # The processor's documented decoder uses audio_chunk_index for internally
            # chunked audio. Passing it is harmless when no internal chunking was needed.
            decoded = processor.decode(
                generated,
                skip_special_tokens=True,
                audio_chunk_index=audio_chunk_index,
                language=lang,
            )
            if isinstance(decoded, str):
                texts = [decoded] if len(valid_chunks) == 1 else [decoded]
            elif isinstance(decoded, (list, tuple)):
                texts = list(decoded)
            else:
                texts = [str(decoded)]
            if len(texts) != len(valid_chunks):
                # Avoid silently assigning a combined transcript to the wrong timestamps.
                # Retry individually through the same documented path.
                log(f'Batch decoder returned {len(texts)} result(s) for {len(valid_chunks)} segment(s); retrying individually')
                texts = []
                for c in valid_chunks:
                    one = processor(c, sampling_rate=sr, return_tensors='pt', language=lang)
                    one_chunk_index = one.get('audio_chunk_index')
                    one.to(model.device, dtype=model.dtype)
                    with torch.inference_mode():
                        one_generated = model.generate(**one, max_new_tokens=max_new_tokens)
                    one_decoded = processor.decode(
                        one_generated,
                        skip_special_tokens=True,
                        audio_chunk_index=one_chunk_index,
                        language=lang,
                    )
                    texts.append(one_decoded[0] if isinstance(one_decoded, (list, tuple)) else one_decoded)
        except Exception as e:
            raise RuntimeError(f'Cohere inference failed for segments {i + 1}-{i + len(valid_chunks)}: {type(e).__name__}: {e}') from e

        inference_seconds += time.perf_counter() - t0
        for (s, e), text in zip(valid_part, texts):
            text = clean_text(text)
            if text:
                out.append({'s': s, 'e': e, 't': text})
        pct = min(99, int((i + len(part)) / len(segs) * 100))
        log(f'progress = {pct}%')
        log(f"COHERE_METRICS completed_segments={min(i + len(part), len(segs))}/{len(segs)} batch_seconds={time.perf_counter()-t0:.1f}s inference_elapsed={time.perf_counter()-inference_started:.1f}s")
    with open(a['out'], 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    log(f"COHERE_TIMING total={time.perf_counter()-started:.1f}s inference={inference_seconds:.1f}s segments={len(segs)} output={len(out)}")
    log('DONE')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        log(f'COHERE_ERROR: {type(exc).__name__}: {exc}')
        traceback.print_exc(file=sys.stdout)
        sys.stdout.flush()
        sys.exit(1)
