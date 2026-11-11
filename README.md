# Insta Clip Studio v1.1.0

A Windows desktop video editor for short-form clips, lectures, recitations, poems, and qasidas. Includes subtitle generation and translation, dual subtitle styling, image/video/audio assets, and MP4 export.

## Build the Windows installer

1. Install Node.js 20+ and the Rust stable toolchain.
2. Run `npm install`.
3. Run `npx tauri icon app-icon.png`.
4. Run `npm run tauri build`.
5. Find the installer under `src-tauri/target/release/bundle/nsis/`.

Or use **GitHub → Actions → Build Windows installer → Run workflow**.

## Project and media notes

- Project-library records are stored locally in the app's WebView storage.
- Project state stores references to source media and imported assets; it does not embed original media files. If a file is moved, re-add/relink it.
- External audio is used for subtitle generation and can be selected as the final soundtrack.
- The dual subtitle layout offers Classic and Parchment / Poem-Qasida styling. Source and translation positions can be adjusted separately.

## Export architecture status

The renderer preserves the custom canvas composition and then uses FFmpeg for audio processing and MP4 encoding. The current pipeline still uses canvas/MediaRecorder capture; it is not yet a fully detached FFmpeg-only render job, and project switching is disabled while export is active. See `PATCH_NOTES.md` for the exact validation status.
