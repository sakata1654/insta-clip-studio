# Insta Clip Studio v1.1.4 — Online Poem/Qasida Recovery

## Implemented
- Poem/qasida transcription can automatically search online after ASR and also provides a manual “Find original poem online & align” action.
- Uses distinctive recognized words to search web results, retrieves candidate page text, scores candidate lines against timestamped Arabic/Urdu ASR segments, and replaces text only where the match threshold is met.
- Keeps audio-derived segment timestamps; couplet mode combines adjacent lines and spans the first line start through the second line end. Unmatched transcript segments are retained.
- Default-on fallback performs local verse grouping and attempts AI-assisted grouping through the already configured translation provider (Gemini/OpenAI-compatible/Anthropic/etc.); if unavailable, it falls back to local grouping.
- Controls are embedded in the existing Auto subtitles section. Existing editor, project data, media, translation, styles and export UI remain in place.

## Important limitations
- Online lookup depends on internet access and the third-party AllOrigins fetch proxy, and some sites block retrieval. Search results are candidates, not authoritative verification. Always review matched lines and the displayed source link before export.
- AI fallback requires a configured provider/key (or local Ollama); otherwise local grouping is used.
- This environment validated JavaScript syntax and archive integrity only. A Windows/Tauri build, network retrieval test, and audio-based alignment accuracy test were not run.
