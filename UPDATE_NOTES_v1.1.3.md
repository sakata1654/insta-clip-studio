# Insta Clip Studio v1.1.3 — Poetry workflow update

## Included
- Clean poem/qasida dual-subtitle controls: source and translation font families, weight, outline width/color, shadow, and border/background choice, while retaining existing classic and parchment layouts.
- Content-type selector before transcription: normal speech, poem/qasida, and religious speech.
- Poetry segmentation mode conservatively preserves recognizer segments as verse candidates and merges only very short fragments across tiny pauses.
- Religious speech mode detects a limited set of common Arabic/Urdu hadith/athar introduction phrases and attempts to split at those boundaries. This is heuristic, not semantic verification; review output.
- Application opens the Projects homepage at startup.

## Validation
- JavaScript syntax checked with Node.js.
- ZIP integrity checked.
- Not compiled as a Windows/Tauri application and not tested with actual Arabic/Urdu recordings in this environment.

## Known limitations
- Automatic poem/rhyme recognition and hadith/athar detection are heuristic. They cannot guarantee correct poetic meter, rhyme, or identify every quotation. Manual review remains necessary.
- Project cards still use the existing local project library. This update does not yet copy every imported media asset into a self-contained project folder; original media paths remain references.
