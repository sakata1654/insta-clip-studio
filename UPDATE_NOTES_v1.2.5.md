# Insta Clip Studio v1.2.5 — Startup / Clickability Recovery

## Fixes
- Moved the non-critical translation-panel render off the synchronous startup path and wrapped it in error handling.
- Isolated startup initialization steps so an optional panel failure is reported instead of preventing later startup steps from running.
- Added emergency bindings for Projects, Back to editor, Open video, Load project, and Save project.
- Added uncaught-error reporting via the app toast to make future runtime failures easier to diagnose.

## Validation
- JavaScript syntax check passed with Node.js.
- ZIP integrity check passed.
- A full Windows/Tauri runtime launch and interactive click test have not been completed in this environment. Please verify with the packaged Windows app.
