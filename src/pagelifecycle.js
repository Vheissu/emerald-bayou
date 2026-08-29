export function bindPageLifecycle({ document: doc = globalThis.document, window: win = globalThis.window, hibernate, resume } = {}) {
  if (!doc?.addEventListener || !win?.addEventListener || typeof hibernate !== 'function' || typeof resume !== 'function') return () => {};
  const visibility = () => { if (doc.hidden) hibernate(); else resume(); };
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', hibernate);
  win.addEventListener('pageshow', resume);
  visibility();
  return () => {
    doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('pagehide', hibernate);
    win.removeEventListener('pageshow', resume);
  };
}
