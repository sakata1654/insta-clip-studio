/**
 * Bidirectional Text & Islamic Honorific Isolation Engine (Engine 2.0)
 *
 * Resolves Unicode Bidirectional Algorithm (UBA) reordering issues across Canvas 2D,
 * HTML DOM, and Video Export.
 *
 * Guarantees that:
 * 1) "The companions of the Prophet ﷺ" stays strictly in left-to-right order with ﷺ in place.
 * 2) Arabic / Urdu lectures maintain native Right-to-Left paragraph flow and punctuation.
 * 3) Mixed-direction sentences are safely isolated with U+2067 (RLI) and U+2069 (PDI).
 */

const RTL_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_REGEX = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

export const HONORIFICS = [
  'ﷺ',
  'صلى الله عليه وسلم',
  'صلى الله عليه وآله وسلم',
  'رضي الله عنه',
  'رضي الله عنها',
  'رضي الله عنهم',
  'رضي الله عنهما',
  'رحمه الله',
  'رحمها الله',
  'رحمهم الله',
  'رحمهما الله',
  'رحمهما الله تعالى',
  'سبحانه وتعالى',
  'عز وجل',
  'جل جلاله',
  'عليه السلام',
  'عليهم السلام',
];

/**
 * Determines whether the overall text has an RTL base direction.
 * A text is RTL if and only if strong RTL characters outnumber strong LTR characters.
 * An English sentence ending with "ﷺ" has 25+ Latin characters and 1 Arabic ligature,
 * so its base direction is unambiguously 'ltr'.
 */
export function isRtlBase(text) {
  if (!text) return false;
  // Strip recognized Islamic honorifics before calculating primary sentence direction
  // so honorific suffixes never misclassify English names (e.g. "Abu Bakr رضي الله عنه")
  let core = String(text);
  for (const h of HONORIFICS) {
    core = core.replaceAll(h, '');
  }
  let ltrCount = 0;
  let rtlCount = 0;
  for (const ch of core) {
    if (RTL_REGEX.test(ch)) rtlCount++;
    else if (LTR_REGEX.test(ch)) ltrCount++;
  }
  if (ltrCount > 0 || rtlCount > 0) {
    return rtlCount > ltrCount;
  }
  return RTL_REGEX.test(text);
}

/**
 * Legacy compatibility alias for existing code, but now using accurate predominant script detection.
 */
export function isRtl(text) {
  return isRtlBase(text);
}

/**
 * Wraps embedded RTL phrases and Islamic honorifics with Unicode Directional Isolates
 * (U+2067 RLI and U+2069 PDI) when placed in a predominantly LTR sentence, or wraps
 * LTR phrases with (U+2066 LRI and U+2069 PDI) in a predominantly RTL sentence.
 *
 * This mathematically prevents the Unicode Bidirectional Algorithm from flipping trailing
 * honorifics like ﷺ to the front of English sentences.
 */
export function shapeBidiText(text) {
  if (!text) return '';
  const str = String(text);
  const rtlBase = isRtlBase(str);

  if (!rtlBase) {
    if (str.includes('\u2067') || str.includes('\u2066')) return str;
    
    let shaped = str;
    for (const h of HONORIFICS) {
      if (shaped.includes(h)) {
        const re = new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        shaped = shaped.replace(re, `\u2067${h}\u2069`);
      }
    }
    shaped = shaped.replace(/(?<![\u2067])([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)(?![\u2069])/g, '\u2067$1\u2069');
    shaped = shaped.replace(/\u2067\u2067/g, '\u2067').replace(/\u2069\u2069/g, '\u2069');
    return shaped;
  } else {
    if (str.includes('\u2066') || str.includes('\u2067')) return str;
    let shaped = str.replace(/(?<![\u2066])([A-Za-z0-9][A-Za-z0-9\s.,'’"()-]*[A-Za-z0-9])(?![\u2069])/g, '\u2066$1\u2069');
    shaped = shaped.replace(/\u2066\u2066/g, '\u2066').replace(/\u2069\u2069/g, '\u2069');
    return shaped;
  }
}

/**
 * Strips Unicode directional isolate markers (U+2066, U+2067, U+2068, U+2069).
 * Used when serializing to plain text SRT files or string-matching.
 */
export function stripBidiControls(text) {
  if (!text) return '';
  return String(text).replace(/[\u2066-\u2069\u202A-\u202E]/g, '');
}

/**
 * Formats mixed text for safe HTML rendering using <bdi> (Bi-directional Isolation) tags.
 */
export function formatHtmlBidi(text) {
  if (!text) return '';
  const rtlBase = isRtlBase(text);
  const clean = stripBidiControls(text);
  if (!rtlBase) {
    let out = clean;
    for (const h of HONORIFICS) {
      if (out.includes(h)) {
        const re = new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        out = out.replace(re, `<bdi dir="rtl" class="honorific">${h}</bdi>`);
      }
    }
    return out;
  }
  return clean;
}
