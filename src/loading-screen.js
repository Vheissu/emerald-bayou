import { LOADING_SCENES, initialLoadingSceneIndex, loadingAssetUrl, shuffledLoadingSceneIndices } from './loading-scenes.js';
import { constrainedAssetTransfer } from './startup.js';

const root = document.getElementById('loading');

if (root) {
  const layers = [...root.querySelectorAll('.loading-art')];
  const status = document.getElementById('loadtext');
  const retry = document.getElementById('loadRetry');
  const track = document.getElementById('loadtrack');
  const fill = track.querySelector('i');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const constrainedTransfer = constrainedAssetTransfer(navigator.connection);
  const requested = new URLSearchParams(window.location.search).get('loading') || '';
  const initialIndex = initialLoadingSceneIndex({ requested, saveData: constrainedTransfer });

  let activeLayer = 0;
  let currentIndex = initialIndex;
  let cycleTimer = 0;
  let releaseTimer = 0;
  let completionTimer = 0;
  let requestSerial = 0;
  let stopped = false;
  let sceneBag = [];

  const applyScene = scene => {
    root.dataset.scene = scene.id;
  };

  const applyArt = (layer, scene, priority = 'auto') => {
    layer.style.setProperty('--art-position', scene.position);
    layer.style.setProperty('--art-position-mobile', scene.mobilePosition);
    layer.fetchPriority = priority;
    layer.src = loadingAssetUrl(scene.src, document.baseURI);
  };

  const refillSceneBag = () => { sceneBag = shuffledLoadingSceneIndices(currentIndex); };

  const scheduleNext = () => {
    window.clearTimeout(cycleTimer);
    if (reducedMotion || constrainedTransfer || stopped || document.hidden) return;
    cycleTimer = window.setTimeout(() => {
      if (!sceneBag.length) refillSceneBag();
      showScene(sceneBag.shift());
    }, 5200);
  };

  async function showScene(index) {
    if (stopped || index === currentIndex) { scheduleNext(); return; }
    const serial = ++requestSerial;
    const incomingIndex = activeLayer === 0 ? 1 : 0;
    const incoming = layers[incomingIndex];
    const outgoing = layers[activeLayer];
    const scene = LOADING_SCENES[index];
    applyArt(incoming, scene);
    try { await incoming.decode(); } catch { /* The naturalWidth check below handles real load failures. */ }
    if (stopped || serial !== requestSerial) return;
    if (!incoming.naturalWidth) { incoming.removeAttribute('src'); scheduleNext(); return; }

    window.requestAnimationFrame(() => {
      if (stopped || serial !== requestSerial || document.hidden) {
        incoming.removeAttribute('src');
        return;
      }
      applyScene(scene);
      currentIndex = index;
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
      activeLayer = incomingIndex;
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        if (!outgoing.classList.contains('is-active')) outgoing.removeAttribute('src');
      }, 1250);
      scheduleNext();
    });
  }

  const progress = (message, value = 0) => {
    if (root.classList.contains('is-error')) return Number(track.getAttribute('aria-valuenow')) || 0;
    const amount = Math.max(0, Math.min(1, Number(value) || 0));
    const percent = Math.round(amount * 100);
    if (message) status.textContent = message;
    fill.style.transform = `scaleX(${amount})`;
    track.setAttribute('aria-valuenow', String(percent));
    return percent;
  };

  const stop = () => {
    stopped = true;
    requestSerial++;
    window.clearTimeout(cycleTimer);
    window.clearTimeout(releaseTimer);
  };

  const destroy = () => {
    stop();
    window.clearTimeout(completionTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    retry?.removeEventListener('click', retryLoad);
    for (const layer of layers) layer.removeAttribute('src');
    window.__loadingScreen = null;
  };

  const complete = () => {
    if (root.classList.contains('is-complete')) return;
    progress('Ready', 1);
    stop();
    root.classList.add('is-complete');
    root.setAttribute('aria-hidden', 'true');
    completionTimer = window.setTimeout(() => { destroy(); root.remove(); }, 900);
  };

  const fail = (message) => {
    stop();
    root.classList.add('is-error');
    status.textContent = message;
    if (retry) retry.hidden = false;
  };

  function retryLoad() { window.location.reload(); }
  retry?.addEventListener('click', retryLoad);

  function onVisibilityChange() {
    window.clearTimeout(cycleTimer);
    if (document.hidden) {
      requestSerial++;
      window.clearTimeout(releaseTimer);
      layers.forEach((layer, index) => {
        if (index === activeLayer) return;
        layer.classList.remove('is-active');
        layer.removeAttribute('src');
      });
      return;
    }
    if (!stopped) scheduleNext();
  }

  applyArt(layers[0], LOADING_SCENES[initialIndex], 'high');
  layers[0].classList.add('is-active');
  applyScene(LOADING_SCENES[initialIndex]);
  refillSceneBag();
  scheduleNext();
  document.addEventListener('visibilitychange', onVisibilityChange);

  window.__loadingScreen = Object.freeze({ scenes: LOADING_SCENES, progress, stop, destroy, complete, fail });
}
