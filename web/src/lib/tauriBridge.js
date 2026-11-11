/**
 * Pure Web Browser Shim replacing desktop Tauri IPC bridge.
 * Never depends on window.__TAURI__ or local Node /api/invoke endpoints.
 */
export function getTauri() {
  return null;
}

export async function invoke() {
  throw new Error('Desktop-only command unavailable in browser web version.');
}

export async function pickLocalBrowserFile(accept = '*/*', multiple = false) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => {
      const files = [...(inp.files || [])];
      inp.remove();
      if (!files.length) return resolve(null);
      resolve(multiple ? files : files[0]);
    };
    inp.click();
  });
}
