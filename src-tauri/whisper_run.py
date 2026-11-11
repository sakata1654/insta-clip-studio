# Same recipe as the original script: faster-whisper, VAD, beam 5, model ladder (large-v3 -> distil-large-v3 -> medium).
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
        ladder = [("large-v3", "cuda", "int8_float16"), ("distil-large-v3", "cuda", "int8_float16"),
                  ("medium", "cuda", "int8_float16"), ("medium", "cpu", "int8")]
    else:
        ladder = [(m, "cuda", "int8_float16"), (m, "cpu", "int8")]
    model = None
    for size, dev, comp in ladder:
        try:
            model = WhisperModel(size, device=dev, compute_type=comp)
            print(f"MODEL {size} on {dev}", flush=True)
            break
        except Exception as e:
            print(f"model {size} on {dev} failed: {e}", flush=True)
    if model is None:
        print("ERROR could not load any Whisper model", flush=True)
        sys.exit(3)
    lang = a.get('lang')
    lang = None if (not lang or lang == 'auto') else lang
    kw = dict(vad_filter=True, vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=500),
              language=lang, beam_size=5, best_of=5,
              condition_on_previous_text=bool(a.get('ctx')), word_timestamps=True)
    if a.get('prompt'):
        kw['initial_prompt'] = a['prompt']
    if a.get('det'):
        kw['temperature'] = 0.0
    if a.get('translate'):
        kw['task'] = 'translate'
    segs, info = model.transcribe(a['audio'], **kw)
    total = max(1.0, float(info.duration))
    raw = []
    for s in segs:
        text = s.text.strip()
        if text:
            raw.append({"s": float(s.start), "e": float(s.end), "t": text,
                        "w": [{"w": w.word, "s": float(w.start), "e": float(w.end)} for w in (s.words or [])]})
        print(f"progress = {min(99, int(s.end / total * 100))}%", flush=True)
    # Whisper's native segments can break a grammatical sentence across boundaries.
    # Merge adjacent pieces until sentence punctuation or a meaningful pause; this also
    # keeps poetic/qasida lines intact where punctuation marks the line ending.
    maxlen = int(a.get('maxlen') or 0)
    max_words = int(a.get('max_words') or 8)
    out = []
    sentence_end = ('.', '?', '!', '؟', '۔', '…', ':', ';', '؛', '।')
    for seg in raw:
        if not out:
            out.append(seg)
            continue
        prev = out[-1]
        gap = max(0.0, seg['s'] - prev['e'])
        ends_sentence = prev['t'].rstrip().endswith(sentence_end)
        combined_text = (prev['t'].rstrip() + ' ' + seg['t'].lstrip()).strip()
        combined_words = combined_text.split()
        too_many_chars = maxlen > 0 and len(combined_text) > maxlen
        too_many_words = max_words > 0 and len(combined_words) > max_words
        too_long = too_many_words or (seg['e'] - prev['s']) > 9.0 or too_many_chars
        # Prefer intact sentences; only start a new caption after punctuation, a long
        # pause, or a safety cap so long lectures still remain readable on screen.
        if ends_sentence or gap >= 0.85 or too_long:
            out.append(seg)
        else:
            prev['t'] = combined_text
            prev['e'] = seg['e']
            prev['w'].extend(seg.get('w', []))
    json.dump(out, open(a['out'], 'w', encoding='utf-8'), ensure_ascii=False)
    print("DONE", flush=True)

main()
