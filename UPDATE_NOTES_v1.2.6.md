# v1.2.6 — Project-first startup fix

- Enforces the project homepage as the first screen after all startup initializers complete.
- Refreshes the recent-project list on launch.
- If project-card rendering fails, leaves the homepage visible and shows a recoverable message instead of silently dropping into the editor.
- Existing editor, autosave, media, AI, and export features are retained.

Validation: HTML/inline JavaScript syntax and ZIP integrity checks are required before release. Windows/Tauri runtime was not available for end-to-end testing.
