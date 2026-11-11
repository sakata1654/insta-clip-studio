# v1.2.9 — Homepage clickability fix

- Moved the Projects homepage outside the editor app/grid stacking context.
- Added explicit pointer-event rules to the homepage and its controls.
- Added direct inline handlers and independent top-level click handling for New project, Save current project, and Back to editor.
- Added visible error feedback when the editor initialization has failed.

Runtime testing in Windows/Tauri is still required. This patch specifically addresses an unclickable homepage, not just its visibility.
