/**
 * Stage 9: Contextual Translation & House Rules Engine
 * Based on PIPELINE_GUIDE.md Sections S3, L1, L2, L3, L4 and Section 4.4 Constitution
 *
 * Implements:
 * 1. S3: Merge segments into cohesive translation units (<= 8s / 22 words)
 * 2. 21 House Rules constitution prompt builder
 * 3. L3: Deterministic English polish (Honorific formulas, straight path, house terms, du'a rule)
 * 4. L3: Style violation scanner (English honorifics, biblical prophet names, untranslated words)
 * 5. L4: First-mention transliterated term glosses
 */

export const HOUSE_RULES_CONSTITUTION = `You are an expert subtitle translator and reviewer producing fluent, natural English captions for Islamic lectures, sermons, and lessons.

21 HOUSE RULES CONSTITUTION:
1. One output line per input line, exactly same order and count. Never merge, split, or skip.
2. Punctuate as running prose across lines. A line that completes a sentence ends with . ? or !. A line continuing a sentence ends with a comma or nothing, never a period.
3. Short sentences: Classical speech chains clauses with "wa" (and). Break long runs into several English sentences of ~25 words or fewer without dropping content.
4. Quotations across lines: Open quote only where quoted material begins and close where it ends.
5. Capitalisation follows sentence flow: Capitalise only after a line that ended a sentence. Never capitalise "And/But/So" mid-sentence.
6. Fidelity first: Never shorten or omit to make a line brief.
7. 'Aqeedah: Allah's names and attributes translated as stated (Hand, Face, rose above the Throne), with NO figurative or allegorical reinterpretation.
8. Transliterate core terms with no exact English equivalent: taqwa, tawakkul, ikhlaas, tawhid, shirk, bid'ah, fiqh, sunnah.
9. Prophets by Qur'anic names: Isa, Musa, Dawud, Ibrahim, Nuh, Ismail, Ishaq, Yaqub, Yusuf, Sulayman, Harun, Ayyub, Yunus, Zakariya, Yahya, Lut (NEVER Biblical names like Jesus, Moses, David, Abraham, Joseph, Solomon).
10. Honorific formulas stay in Arabic script inline: ﷺ (for Prophet Muhammad), عليه السلام, رضي الله عنه, رضي الله عنها, رضي الله عنهم, رحمه الله, سبحانه وتعالى, جل وعلا, عز وجل, تبارك وتعالى. NEVER in English ("peace be upon him") and NEVER transliterated.
11. Fixed formulas only: Ordinary personal blessings (جزاك الله خيرا, بارك الله فيك) are translated normally.
12. Add an honorific ONLY where actually spoken in this line's Arabic. Never where not spoken.
13. Qur'an citations: Formal and reverent register.
14. Hadith: Accurate, complete, clear direct register.
15. Context block: Only for resolving pronouns and flow; never duplicate it.
16. Unclear audio: Best-informed reading from context; no bracketed placeholders.
17. Q&A in one line: Keep turns in order spoken.
18. Stutters & false starts: Translate final wording once. Deliberate repetition is kept.
19. Announced numbered headings ("المسألة الخامسة"): Render as own capitalised sentence: "The fifth issue."
20. House terms: 'aqeedah (not "creed"); kalam / "the people of kalam" (not "theology/theologians"); "the straight path" for الصراط المستقيم (never "Sirat al-Mustaqim"); 'ujb; niyyah; al-Fatihah; naseehah; wara'; at-tamaneenah (with "(tranquility)" at first mention); khiyar.
21. First-mention glosses: Rare transliterated terms get a brief explanation in parentheses at first mention only.`;

export const BIBLICAL_PROPHET_MAP = new Map([
  ['jesus', 'Isa'],
  ['moses', 'Musa'],
  ['abraham', 'Ibrahim'],
  ['noah', 'Nuh'],
  ['david', 'Dawud'],
  ['solomon', 'Sulayman'],
  ['joseph', 'Yusuf'],
  ['aaron', 'Harun'],
  ['ishmael', 'Ismail'],
  ['isaac', 'Ishaq'],
  ['jacob', 'Yaqub'],
  ['job', 'Ayyub'],
  ['jonah', 'Yunus'],
  ['lot', 'Lut'],
  ['zechariah', 'Zakariya'],
  ['john the baptist', 'Yahya'],
]);

export const HOUSE_TERMS_MAP = new Map([
  [/\bcreed\b/gi, "'aqeedah"],
  [/\btheology\b/gi, 'kalam'],
  [/\btheologians\b/gi, 'people of kalam'],
  [/\bsirat al-mustaqim\b/gi, 'the straight path'],
  [/\bniyah\b/gi, 'niyyah'],
  [/\bpeace be upon him\b/gi, 'ﷺ'],
  [/\b\(pbuh\)\b/gi, 'ﷺ'],
  [/\bpbuh\b/gi, 'ﷺ'],
  [/\b\(saw\)\b/gi, 'ﷺ'],
  [/\b\(ra\)\b/gi, 'رضي الله عنه'],
  [/\b\(rh\)\b/gi, 'رحمه الله'],
]);

/**
 * Merges segments into units of up to 8s or 22 words (PIPELINE_GUIDE.md S3).
 * @param {Array<{ s: number, e: number, t: string }>} segments
 * @param {number} maxDuration Max duration in seconds (default 8.0)
 * @param {number} maxWords Max words in unit (default 22)
 * @returns {Array<{ s: number, e: number, text: string, segments: Array<any> }>}
 */
export function mergeIntoTranslationUnits(segments, maxDuration = 8.0, maxWords = 22) {
  if (!segments || !segments.length) return [];
  const groups = [];
  let cur = [];

  for (const seg of segments) {
    if (cur.length) {
      const dur = seg.e - cur[0].s;
      const totalWords = cur.reduce((sum, s) => sum + (s.t || '').split(/\s+/).filter(Boolean).length, 0) +
        (seg.t || '').split(/\s+/).filter(Boolean).length;
      const gap = seg.s - cur[cur.length - 1].e;

      if (gap > 2.0 || dur > maxDuration || totalWords > maxWords || seg.isQuran || cur[0].isQuran) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(seg);
  }

  if (cur.length) groups.push(cur);

  return groups.map((g) => ({
    s: g[0].s,
    e: g[g.length - 1].e,
    text: g.map((s) => s.t).join(' '),
    segments: g,
  }));
}

/**
 * Deterministic English Polish (L3):
 * Enforces house terms, prophet names, honorific placements, and du'a rules.
 */
export function polishEnglishTranslation(englishText, arabicText = '') {
  if (!englishText) return '';
  let res = String(englishText).trim();

  // 1. House Terms Replacement
  for (const [regex, replacement] of HOUSE_TERMS_MAP.entries()) {
    res = res.replace(regex, replacement);
  }

  // 2. Biblical to Qur'anic Prophet Names
  for (const [biblical, quranic] of BIBLICAL_PROPHET_MAP.entries()) {
    const reg = new RegExp(`\\b${biblical}\\b`, 'gi');
    res = res.replace(reg, quranic);
  }

  // 3. Honorific Punctuation: No period before an Arabic honorific
  res = res.replace(/\.\s*(ﷺ|عليه السلام|رضي الله عنه|رحمه الله|سبحانه وتعالى)/gu, ' $1.');

  // 4. Du'a Rule: Second person prayer for listener ("أن يجعلك", "بارك الله فيك")
  if (arabicText && /جعلك|يهديك|يحفظك|يرحمك|يبارك فيك/u.test(arabicText)) {
    res = res.replace(/^make me\b/i, 'May Allah make you');
    res = res.replace(/^guide me\b/i, 'May Allah guide you');
    res = res.replace(/^protect me\b/i, 'May Allah protect you');
  }

  return res;
}

/**
 * Scans translation for style violations (L3).
 * Detects English honorifics, biblical prophet names, untranslated words.
 */
export function scanTranslationStyleViolations(cues) {
  const violations = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const en = String(c.en || '').trim();

    // English honorific
    if (/peace be upon him|\(pbuh\)|saww|p\.b\.u\.h/i.test(en)) {
      violations.push({
        cueId: c.id,
        index: i,
        type: 'honorific_style',
        message: 'English honorific used instead of Arabic script ﷺ',
      });
    }

    // Biblical prophet names
    for (const [biblical, quranic] of BIBLICAL_PROPHET_MAP.entries()) {
      if (new RegExp(`\\b${biblical}\\b`, 'i').test(en)) {
        violations.push({
          cueId: c.id,
          index: i,
          type: 'prophet_name',
          message: `Biblical prophet name "${biblical}" used instead of Qur'anic name "${quranic}"`,
        });
      }
    }

    // Untranslated Arabic words lingering in English
    const lingeringArabic = en.match(/[\u0600-\u06FF]{3,}/g);
    if (lingeringArabic) {
      const allowed = new Set(['ﷺ', 'الله', 'سبحانه', 'وتعالى', 'عليه', 'السلام', 'رضي', 'عنه', 'رحمه']);
      const filtered = lingeringArabic.filter((w) => !allowed.has(w));
      if (filtered.length) {
        violations.push({
          cueId: c.id,
          index: i,
          type: 'untranslated_text',
          message: `Untranslated Arabic text found in English: "${filtered.join(' ')}"`,
        });
      }
    }
  }

  return violations;
}
