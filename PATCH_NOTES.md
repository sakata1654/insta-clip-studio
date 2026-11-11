# Insta Clip Studio v1.1.2 — Cohere transcription optimization

## Changes
- Replaced the old per-VAD-segment `model.generate()` hot loop with Cohere Transcribe's native `model.transcribe()` API in grouped calls, retaining VAD-derived start/end timestamps for subtitle segments.
- Kept conservative inference batch sizes for low-VRAM GPUs (batch 1 below 6 GB VRAM; 2 for 6–10 GB; 4 above 10 GB) to reduce out-of-memory risk.
- Added `model.eval()` and `torch.inference_mode()` to the compatibility fallback.
- Reduced fallback generation cap from 400 to 256 new tokens to avoid excessive decode work on unusual long generations while preserving normal speech transcripts.
- Added per-stage and per-group timing diagnostics, segment progress, and a resampling guard for inputs not already at 16 kHz.
- A failed optimized group retries only that group via the compatible generation path, rather than repeating previously completed segments.
- Kept VAD-based timestamp reconstruction, English/Arabic model selection, current UI event protocol, and existing project features.

## Validation
- Python syntax compilation passed for Cohere, Whisper, and environment-check scripts.
- JavaScript syntax check passed.
- ZIP integrity check passed.
- This environment does not have the user's Windows GPU/model runtime, so no real Cohere inference speed or accuracy benchmark was possible here. The script emits `COHERE_TIMING` and `COHERE_METRICS` lines so the user can measure actual timing on their RTX 3050. Compare a fixed 2-minute sample before and after; do not assume a speedup until measured.


## v1.2.3 — Timeline zoom and range export
- Added horizontal timeline zoom (1×–8×), zoom in/out and Fit controls, with horizontal scrolling for precise subtitle and text block editing.
- Added Export range controls for timestamp-based start/end, including buttons to capture the current playhead as either boundary.
- Export range applies to the existing trim/export pipeline; timeline trim handles and transport trim buttons stay synchronized with the export range fields.
- Validates timestamp input and rejects end times beyond the loaded source duration.
