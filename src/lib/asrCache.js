const ASR_CACHE_KEY = 'icsAsrCacheV1';
const MAX_CACHE_ENTRIES = 10;

export function makeAsrCacheKey({ name = '', size = 0, dur = 0, engine = '', model = '', lang = 'auto', prompt = '' }) {
  return [
    String(name).slice(0, 120),
    Number(size) || 0,
    Math.round(Number(dur) || 0),
    String(engine).toLowerCase(),
    String(model),
    String(lang),
    String(prompt).trim().slice(0, 160),
  ].join('|');
}

export function getCachedAsr(key) {
  try {
    const raw = localStorage.getItem(ASR_CACHE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    const hit = list.find((x) => x && x.key === key);
    return hit ? hit.data : null;
  } catch {
    return null;
  }
}

export function setCachedAsr(key, data) {
  try {
    const raw = localStorage.getItem(ASR_CACHE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    list = list.filter((x) => x && x.key !== key);
    list.unshift({ key, ts: Date.now(), data });
    while (list.length > MAX_CACHE_ENTRIES) list.pop();
    localStorage.setItem(ASR_CACHE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors gracefully
  }
}
