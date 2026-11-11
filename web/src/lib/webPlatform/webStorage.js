/**
 * Browser Persistence & Local Media Adapter
 * - IndexedDB stores imported File/Blob assets + optional FileSystemFileHandle (Chrome/Edge)
 * - Gracefully handles browser storage quota limits & missing/relinkable files across sessions
 * - Validates imported media size & MIME type upfront
 */

const DB_NAME = 'icsWebStudioDb';
const DB_VERSION = 1;
const STORE_MEDIA = 'media'; // key: assetKey -> { id, projectId, name, type, mime, size, blob, handle, updatedAt }
const STORE_KV = 'kv';

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        const s = db.createObjectStore(STORE_MEDIA, { keyPath: 'key' });
        s.createIndex('byProject', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbPromise;
}

export function mediaKey(projectId, assetId) {
  return `${projectId || 'global'}::${assetId}`;
}

export function validateMediaFile(file, expectedKind = null) {
  if (!file || typeof file.size !== 'number') return { ok: false, reason: 'No valid file selected.' };
  if (file.size === 0) return { ok: false, reason: `File "${file.name}" is empty (0 bytes).` };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  const isVid = mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext);
  const isAud = mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext);
  const isImg = mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext);
  if (expectedKind === 'video' && !isVid) return { ok: false, reason: `"${file.name}" is not a supported video file.` };
  if (expectedKind === 'audio' && !isAud && !isVid) return { ok: false, reason: `"${file.name}" is not a supported audio file.` };
  if (expectedKind === 'image' && !isImg) return { ok: false, reason: `"${file.name}" is not a supported image file.` };
  if (!isVid && !isAud && !isImg) return { ok: false, reason: `Unsupported file format: .${ext || 'unknown'}` };
  return { ok: true, kind: isVid ? 'video' : isAud ? 'audio' : 'image' };
}

export async function getStorageStats() {
  try {
    if (!navigator?.storage?.estimate) return { usedMb: null, quotaMb: null, pct: null };
    const est = await navigator.storage.estimate();
    const usedMb = Math.round(((est.usage || 0) / (1024 * 1024)) * 10) / 10;
    const quotaMb = Math.round(((est.quota || 0) / (1024 * 1024)) * 10) / 10;
    const pct = quotaMb > 0 ? Math.min(100, Math.round((usedMb / quotaMb) * 100)) : null;
    return { usedMb, quotaMb, pct };
  } catch {
    return { usedMb: null, quotaMb: null, pct: null };
  }
}

export async function saveMediaToIdb({ projectId = 'global', assetId, file, handle = null, kind = 'video' }) {
  const db = await openDb();
  if (!db || !file) return { stored: false, reason: 'IndexedDB unavailable' };
  const key = mediaKey(projectId, assetId);
  // Respect browser storage quotas for huge files if a FileSystemFileHandle is present or warn gracefully
  const est = await getStorageStats();
  const fileMb = file.size / (1024 * 1024);
  if (est.quotaMb && est.usedMb !== null && est.usedMb + fileMb > est.quotaMb * 0.92 && !handle) {
    return { stored: false, quotaExceeded: true, reason: `Browser storage near limit (${est.usedMb}/${est.quotaMb} MB). File kept in session memory only.` };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      // If we have a FileSystemFileHandle, avoid duplicating multi-hundred-MB files when file > 220 MB unless small enough
      const record = {
        key,
        projectId,
        assetId,
        name: file.name,
        kind,
        mime: file.type || '',
        size: file.size,
        blob: handle && file.size > 220 * 1024 * 1024 ? null : file,
        handle: handle || null,
        updatedAt: Date.now(),
      };
      store.put(record);
      tx.oncomplete = () => resolve({ stored: true, backedByHandle: !!record.handle && !record.blob });
      tx.onerror = () => resolve({ stored: false, reason: tx.error?.message || 'IndexedDB write failed' });
    } catch (e) {
      resolve({ stored: false, reason: e?.message || 'Storage error' });
    }
  });
}

export async function loadMediaFromIdb(projectId = 'global', assetId) {
  const db = await openDb();
  if (!db) return null;
  const key = mediaKey(projectId, assetId);
  const rec = await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MEDIA, 'readonly');
      const req = tx.objectStore(STORE_MEDIA).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (!rec) return null;

  if (rec.blob instanceof Blob) {
    const f = rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name || 'media', { type: rec.mime || rec.blob.type });
    return { file: f, status: 'ready', record: rec };
  }

  if (rec.handle) {
    try {
      let perm = await rec.handle.queryPermission?.({ mode: 'read' });
      if (perm !== 'granted') {
        perm = await rec.handle.requestPermission?.({ mode: 'read' });
      }
      if (perm === 'granted') {
        const f = await rec.handle.getFile();
        return { file: f, status: 'ready', record: rec, handle: rec.handle };
      }
      return { file: null, status: 'permission-needed', record: rec, handle: rec.handle };
    } catch {
      return { file: null, status: 'missing', record: rec };
    }
  }
  return { file: null, status: 'missing', record: rec };
}

export async function deleteProjectMediaFromIdb(projectId) {
  const db = await openDb();
  if (!db || !projectId) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const idx = tx.objectStore(STORE_MEDIA).index('byProject');
      const req = idx.openCursor(IDBKeyRange.only(projectId));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          cur.delete();
          cur.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function pickFileWithAccessApi(acceptMap) {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: acceptMap,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { file, handle };
    } catch (e) {
      if (e?.name === 'AbortError') return null;
    }
  }
  return null;
}
