# Insta Clip Studio v1.3.0 — consolidated build

## Baseline and stability changes
- Built from the v1.3.0 project source while retaining the v1.2.2-compatible editor/export pipeline and the v1.3.0 feature additions.
- Removed competing project-home button assignments and removed the earlier project-home render from the core initialization list. The final project-home controller is the single owner of Home/New/Save/Back actions.
- Explicitly sets project-home pointer/visibility/accessibility state on show/hide and clears stale action errors before retrying.

## Included workflows
- Project home with create/open/update/delete and project name.
- 3-second project state/recovery autosave; desktop project-media bundling/relink warnings.
- Timeline zoom, fit, horizontal scrolling and timestamp-range export with start/end-from-playhead controls.
- AI clip two-pass automatic/manual prompt workflow, response import/validation, approved-clip batch export and 150-second default duration ceiling.
- Editable keyboard shortcuts.
- Existing subtitle, dual-language/poem, assets/audio, translation, FFmpeg export and progress UI retained.

## Validation status
- Inline JavaScript extracted and checked with Node.js syntax checker.
- ZIP integrity checked.
- This environment cannot validate the actual Windows/Tauri runtime, native file dialogs, media codec availability, or perform an interactive end-to-end export. Those must be tested on Windows before this build is treated as release-certified.
