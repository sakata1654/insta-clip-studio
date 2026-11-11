const listeners = new Map();
let sseConnected = false;

function connectSse() {
  if (sseConnected || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  sseConnected = true;
  try {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const list = listeners.get(msg.event) || [];
        for (const fn of list) fn({ payload: msg.payload });
      } catch {}
    };
  } catch {}
}

async function pickLocalFile(accept, multiple) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    if (multiple) inp.multiple = true;
    inp.onchange = async () => {
      const files = [...(inp.files || [])];
      if (!files.length) return resolve(null);
      const uploaded = [];
      for (const f of files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const r = await fetch('/api/invoke/upload_temp', {
          method: 'POST',
          headers: { name: encodeURIComponent(f.name) },
          body: buf,
        });
        if (!r.ok) {
          resolve(null);
          return;
        }
        const j = await r.json();
        uploaded.push(j.path);
      }
      resolve(multiple ? uploaded : uploaded[0]);
    };
    inp.click();
  });
}

const devBridge = {
  __isDevBridge: true,
  core: {
    invoke: async (cmd, args, opts) => {
      connectSse();
      if (args instanceof Uint8Array) {
        const hdr = (opts && opts.headers) || {};
        const r = await fetch('/api/invoke/' + cmd, {
          method: 'POST',
          headers: { ...hdr, 'content-type': 'application/octet-stream' },
          body: args,
        });
        if (!r.ok) throw new Error(await r.text());
        return await r.json().catch(() => null);
      }
      if (cmd === 'read_file') {
        const r = await fetch('/api/invoke/read_file', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        });
        if (!r.ok) throw new Error(await r.text());
        return await r.arrayBuffer();
      }
      const r = await fetch('/api/invoke/' + cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args || {}),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'HTTP ' + r.status);
      return j;
    },
  },
  event: {
    listen: (ev, cb) => {
      connectSse();
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(cb);
      return Promise.resolve(() => {
        const arr = listeners.get(ev) || [];
        const ix = arr.indexOf(cb);
        if (ix >= 0) arr.splice(ix, 1);
      });
    },
  },
  http: {
    fetch: (url, init = {}) =>
      fetch('/api/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          method: init.method || 'GET',
          headers: init.headers || {},
          body: init.body,
        }),
      }),
  },
  dialog: {
    open: async (opts = {}) => {
      if (opts.directory) {
        return prompt('Enter folder path on this PC (leave blank for default Downloads):', '') || null;
      }
      const exts = (opts.filters || []).flatMap((f) => f.extensions || []).map((x) => '.' + x).join(',');
      return await pickLocalFile(exts || '*/*', !!opts.multiple);
    },
    save: async (opts = {}) => {
      return prompt('Save file path (leave blank to download in browser):', opts.defaultPath || 'output') || null;
    },
  },
  path: {
    tempDir: async () => 'C:\\Windows\\Temp',
    documentDir: async () => 'Documents',
    downloadDir: async () => '',
    join: async (...parts) => parts.filter(Boolean).join('/'),
  },
};

export function getTauri() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ? window.__TAURI__ : devBridge;
}

export function isDevPreviewBridge() {
  const ta = getTauri();
  return !!ta?.__isDevBridge;
}
