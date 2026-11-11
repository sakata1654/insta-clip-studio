# v1.2.7 — Project-first startup correction

- The Projects homepage is visible by default in the shipped frontend HTML, rather than relying only on a deferred JavaScript timer.
- Raised the homepage overlay z-index and enabled pointer events so it remains above the editor until the user explicitly opens a project or returns to the editor.
- Synchronized package and Tauri application versions to 1.2.7 (previous Tauri config still reported 1.2.4).

## Important
This is a source patch. Rebuild the Windows installer from this exact folder and install the newly generated installer; replacing source files alone will not update an already installed executable. Runtime verification still required.
