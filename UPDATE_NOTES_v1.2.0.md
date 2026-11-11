# Insta Clip Studio v1.2.0 — AI Assistant Video (two-pass analysis)

## Added
- New **AI Clips** workspace with optional original video URL context, clip-count and maximum-duration controls, and extra instructions.
- Two-pass analysis using the configured AI API provider:
  1. **Pass 1:** build a chronological topic map across the complete timestamped subtitle transcript.
  2. **Pass 2:** select distinct, self-contained clip candidates using the topic map and full transcript.
- Candidate validation: source-relative timestamps, positive duration, end within transcript duration, configurable maximum length (default 150 seconds), and conservative duplicate-overlap filtering.
- Candidate review cards with title, summary, reason, score, warnings, approval checkbox, and JSON export.
- **Use in editor** loads the clip's source start/end into the existing timeline; the user can preview and render it through the normal export workflow.
- Copy transcript as SRT and save the analysis JSON.

## Important limitation
This version sends the original video URL as text context but does **not** upload local video bytes or frames to the AI API. Therefore the analysis is explicitly marked `transcript_only`; visual/audio analysis is not claimed, and the model is instructed not to invent visual notes. This is the safe transcript-first implementation. Direct multimodal video upload/access needs a separate supported Gemini video-input flow.

## Configuration
Open **AI Clips → AI API settings**, select Google Gemini (recommended) or another configured provider, enter the API key/model/base URL, and **Save**. Import an SRT or generate subtitles before running analysis.

## Verification performed
- JavaScript syntax check (`node --check`) passed.
- Source archive structure and required UI/handler markers checked.
- A real provider call, Windows/Tauri build, and media export were not run in this environment; test those in the Windows build workflow.
