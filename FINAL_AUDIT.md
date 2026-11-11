# Final source audit — v1.1.0

## Source checks completed in this environment

- JavaScript: the inline application script passes `node --check`.
- Python: `whisper_run.py`, `cohere_run.py`, and `env_check.py` pass Python syntax compilation.
- Configuration: `package.json`, `tauri.conf.json`, and `capabilities/default.json` parse as JSON.
- Workflow: CI now performs the JavaScript, Python, and JSON checks before building the installer.
- ZIP: archive integrity is checked after packaging.

## Functional source changes

- Project opening resets stale session state, restores a saved source video when its path is still available, restores external audio, and rehydrates overlays.
- Project JSON import attempts to restore media references and active external audio.
- Project autosave refreshes the source path/name and asset references.
- New Project clears the active media and editing state rather than carrying the previous project's video/audio/assets into the new session.
- Frame image asset path is saved and restored.
- Dual subtitle source and translation use separate position values, separate hit boxes, and an explicit drag-target selector for overlapping text.
- Export progress is mirrored in a cover over the preview to stop visible preview playback from distracting during rendering.

## Release blockers / not verified

- This environment has no Rust/Cargo toolchain, so the Tauri application and Windows installer could not be compiled here.
- No full Windows GUI automation was available; actual playback, drag interaction, model inference, media relinking, and exported-file quality still require a Windows smoke test.
- The export path still records the rendered canvas with `MediaRecorder` and then uses FFmpeg to process audio and encode MP4. It does not yet satisfy the requested architecture of a detached FFmpeg-only render that lets the user switch projects while export continues. Project switching is intentionally blocked during export to prevent live editor state from changing mid-render.
- Source media files are referenced by local paths rather than embedded in project data. If media is moved or removed, it must be relinked.

This report intentionally distinguishes static checks from end-to-end verification; passing syntax checks does not prove that the Windows application works correctly.
