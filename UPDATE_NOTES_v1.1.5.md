# Insta Clip Studio v1.1.5 — Accuracy-first Cohere transcription

## Cohere transcription changes
- Removed the speculative `model.transcribe()` path. The runner now uses the documented Transformers `AutoProcessor` + `CohereAsrForConditionalGeneration.generate()` + `processor.decode()` path.
- Preserves and passes `audio_chunk_index` and the selected language into decoding, so processor-internal chunk output can be reconstructed correctly.
- Restores real batch inference within the detected VRAM budget instead of grouping four times the batch size and then issuing separate generation calls.
- Raises the generation ceiling from 256 to 512 tokens per VAD segment to reduce the risk of cutting off dense speech or poetry. A higher ceiling does not guarantee accuracy, but avoids the lower cap introduced in v1.1.2.
- Keeps VAD-based timestamp reconstruction and all existing UI, projects, poem/qasida recovery, subtitle, media and export features unchanged.
- If batch decoding returns a result count that cannot be mapped safely to segments, retries those segments individually rather than assigning a combined transcript to the wrong timestamps.

## Validation and limitations
- Python syntax compilation: PASS.
- ZIP integrity: PASS after packaging.
- Static review against Cohere's published Transformers usage: PASS.
- Windows/Tauri build: NOT RUN in this environment.
- Real Arabic audio accuracy benchmark: NOT RUN (no reference audio/transcript supplied and model inference is not available here). This update is a code-level correction, not a claim of measured WER improvement.
- Urdu is not supported by the Cohere model configured in this app; use a Whisper engine for Urdu.
