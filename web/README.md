# InstaClip Studio Web

Browser-native video editing workspace powered by **Svelte 5**, **Canvas 2D**, **WebCodecs (`mp4-muxer` + Web Worker)**, **MediaPipe WASM**, **IndexedDB**, and **Vercel Serverless Functions**.

## Features & Browser Adaptation
- **100% Local Video Processing**: Video playback, Canvas 2D compositing, speaker auto-framing (`BlazeFace` WASM), timeline scrubbing, decoded audio waveforms, and background WebCodecs MP4 export run locally in your browser without uploading video files.
- **Persistent Browser Projects**: Projects and local media files/handles persist in `IndexedDB` + `localStorage`, with graceful missing-media relinking if browser storage permissions expire.
- **Cloud AI & Lightweight Transcription**:
  - AI workflows (Smart Clips, Self-Training Coach, Semantic Subtitle Rearranger, ASR Proofreader, Translation Desk) proxy securely through `POST /api/ai`.
  - Transcription (`POST /api/transcribe`) extracts lightweight 16 kHz mono WAV audio chunks locally via Web Audio API (< 3.5 MB/chunk, respecting Vercel's serverless payload limits) so gigabyte videos never need to leave your device.
- **Desktop-Only Features**: `yt-dlp` YouTube downloading and PyTorch Demucs vocal stem separation remain exclusive to the Tauri desktop app ([`../src-tauri`](../src-tauri)).

## Adaptive Cross-Device Experience & Future Mobile Packaging
- **Adaptive Layouts** ([`viewport.svelte.js`](src/lib/webPlatform/viewport.svelte.js)): Live viewport, orientation, virtual keyboard, and coarse-pointer detection adapt the workspace across:
  - **Desktop / Laptop** (`>= 1024px`): Full 4-column NLE with resizable panels.
  - **Tablet Landscape** (`768–1023px` landscape): Centered preview + timeline with collapsible Tools/Inspector side drawers.
  - **Tablet Portrait** (`600–1023px` portrait): Full-width preview + timeline with slide-over Tools/Inspector drawers.
  - **Mobile Phones** (`< 600px` small & large phones): Compact header, pinch-zoomable preview & fullscreen toggle, touch timeline (`18px` trim grips, track focus tabs, pinch-to-zoom, long-press inspect, fullscreen expand), bottom navigation bar, and slide-up bottom sheets with safe-area insets and virtual keyboard awareness.
- **PWA & Native Share**: Installable standalone Web App ([`manifest.webmanifest`](public/manifest.webmanifest), [`sw.js`](public/sw.js)) with Web Share API (`navigator.share`) export support on mobile browsers.
- **Future Android/iOS Wrapping**: All business logic (`prompts.js`, `aiClipTrainer.js`, `presets.js`, `renderer.js`, `state.svelte.js`) stays cleanly decoupled from platform adapters (`src/lib/webPlatform/`), enabling seamless wrapping with **Capacitor** later (`webDir: "dist"`, swapping only storage/share/native export plugins as needed).

## Vercel Deployment (GitHub Integration)
1. In Vercel, import `sakata1654/insta-clip-studio` and set **Root Directory** to `web`.
2. Build Command: `npm run build` · Output Directory: `dist`.
3. Add Environment Variables in Vercel Project Settings (keep private server-side only):
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `WEB_ALLOW_BYOK=true` (set `false` to disable browser-supplied override keys)

## Local Development
```bash
cd web
npm install
npm run dev
```
