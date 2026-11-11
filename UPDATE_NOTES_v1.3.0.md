# v1.3.0 — Project lifecycle repair

- Removed competing v1.2.8/v1.2.9 capture-phase homepage handlers.
- Removed duplicate emergency navigation assignments and duplicate startup timers.
- Replaced them with one direct-button controller for New project, Save current project, Back to editor, and Projects.
- Removed forced extreme z-index and blanket pointer-event overrides; the homepage remains a top-level overlay with a controlled z-index.
- Added visible error feedback for project actions and unhandled JavaScript failures.
- Updated the visible homepage version.

Validation performed: all inline JavaScript blocks parse with Node.js; Tauri and package JSON parse; ZIP archive integrity checked. Actual Windows/Tauri end-to-end interaction testing remains required.
