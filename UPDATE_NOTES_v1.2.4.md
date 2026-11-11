# Insta Clip Studio v1.2.4 — Project Reliability & Clip Quality

- Project home is the startup screen; create a named project or reopen an existing project.
- Active project state and recovery snapshots autosave every 3 seconds.
- Desktop project media bundling copies the source video and imported file-backed assets into `Documents/Insta Clip Studio/Projects/<project-id>/Media` where readable. Paths are updated to the project copy.
- Export outputs now live in the active project's folder and the desktop MP4 export checks that the output has a readable duration close to the requested range.
- Downloaded clips open directly in the editor and are added to Assets; if the download path is stale, the user can choose the file to relink it.
- AI clip prompts now prioritize complete standalone ideas, inspect surrounding context, avoid mid-sentence/mid-explanation endings, and prefer rejecting incomplete ideas over cutting them off.
- AI clip candidates with suspicious transcript endings or missing excerpts are flagged for manual review.
- Added approved-clip batch export.
- Added editable keyboard shortcuts for play/pause, subtitle split, undo/redo, seek, range start/end, and save.
- Existing timeline zoom controls remain available; `S` splits the selected subtitle at the playhead when the playhead is inside its range.

## Verification

- Inline JavaScript syntax check: passed with Node.js `--check`.
- ZIP archive integrity: checked after packaging.
- Rust/Tauri build and real video export were not run because Cargo is unavailable in this environment. Please run the Windows build and verify with a sample video before using for production exports.
