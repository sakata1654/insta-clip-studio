# Tibyan Engine 2.0: faster-whisper with VAD, hallucination prevention, CUDA compute ladder, and full word timestamps.
import sys, json

def main():
    a = json.load(open(sys.argv[1], encoding='utf-8'))
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR faster-whisper is not installed", flush=True)
        sys.exit(2)
    m = a.get('model') or 'auto'
    if m == 'auto':
        ladder = [
            ("large-v3", "cuda", "float16"),
            ("large-v3", "cuda", "int8_float16"),
            ("large-v3", "cuda", "int8"),
            ("distil-large-v3", "cuda", "int8_float16"),
            ("medium", "cuda", "int8_float16"),
            ("medium", "cpu", "int8")
        ]
    else:
        ladder = [
            (m, "cuda", "float16"),
            (m, "cuda", "int8_float16"),
            (m, "cuda", "int8"),
            (m, "cpu", "int8")
        ]
    model = None
    for size, dev, comp in ladder:
        try:
            model = WhisperModel(size, device=dev, compute_type=comp)
            print(f"MODEL {size} on {dev} ({comp})", flush=True)
            break
        except Exception as e:
            print(f"model {size} on {dev} ({comp}) failed: {e}", flush=True)
    if model is None:
        print("ERROR could not load any Whisper model", flush=True)
        sys.exit(3)
    lang = a.get('lang')
    lang = None if (not lang or lang == 'auto') else lang
    
    # Strictly enforce:
    # 1. condition_on_previous_text=False (prevents repetition loops and hallucination cascades)
    # 2. hallucination_silence_threshold=2.0 (discards hallucinated boilerplates during pauses)
    # 3. word_timestamps=True (audio ground truth)
    # 4. No repetition penalties (preserves natural rhetorical repetitions in lectures)
    kw = dict(
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=500),
        language=lang,
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
        word_timestamps=True,
    )
    if a.get('prompt'):
        kw['initial_prompt'] = a['prompt']
    if a.get('det'):
        kw['temperature'] = 0.0
    if a.get('translate'):
        kw['task'] = 'translate'
    
    segs, info = model.transcribe(a['audio'], **kw)
    total = max(1.0, float(info.duration))
    raw_segments = []
    all_words = []
    
    for s in segs:
        text = s.text.strip()
        words_in_seg = []
        for w in (s.words or []):
            w_obj = {"w": w.word, "s": float(w.start), "e": float(w.end)}
            words_in_seg.append(w_obj)
            all_words.append({
                "word": w.word,
                "start": float(w.start),
                "end": float(w.end),
                "probability": getattr(w, 'probability', 1.0)
            })
        if text:
            raw_segments.append({
                "s": float(s.start),
                "e": float(s.end),
                "t": text,
                "w": words_in_seg
            })
        print(f"progress = {min(99, int(s.end / total * 100))}%", flush=True)
    
    output_payload = {
        "segments": raw_segments,
        "words": all_words,
        "engine": "faster-whisper",
        "duration": total,
        "language": getattr(info, 'language', lang)
    }
    
    json.dump(output_payload, open(a['out'], 'w', encoding='utf-8'), ensure_ascii=False)
    print("DONE", flush=True)

if __name__ == '__main__':
    main()
