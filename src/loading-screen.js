import { LOADING_SCENES, initialLoadingSceneIndex, loadingAssetUrl, shuffledLoadingSceneIndices } from './loading-scenes.js';

const root = document.getElementById('loading');

if (root) {
  const layers = [...root.querySelectorAll('.loading-art')];
  const chapter = document.getElementById('loadchapter');
  const note = document.getElementById('loadnote');
  const sceneNumber = document.getElementById('loadscene');
  const district = document.getElementById('loaddistrict');
  const status = document.getElementById('loadtext');
  const percentage = document.getElementById('loadpct');
  const track = document.getElementById('loadtrack');
  const fill = track.querySelector('i');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData === true;
  const requested = new URLSearchParams(window.location.search).get('loading') || '';
  const initialIndex = initialLoadingSceneIndex({ requested, saveData });

  let activeLayer = 0;
  let currentIndex = initialIndex;
  let cycleTimer = 0;
  let releaseTimer = 0;
  let completionTimer = 0;
  let requestSerial = 0;
  let stopped = false;
  let sceneBag = [];

  const applyCopy = (scene, index) => {
    chapter.textContent = scene.title;
    note.textContent = scene.note;
    sceneNumber.textContent = `${String(index + 1).padStart(2, '0')} / ${String(LOADING_SCENES.length).padStart(2, '0')}`;
    district.textContent = scene.district;
    root.style.setProperty('--scene-accent', scene.accent);
    root.dataset.scene = scene.id;
    const story = root.querySelector('.loading-story');
    story.classList.remove('is-changing');
    void story.offsetWidth;
    story.classList.add('is-changing');
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
    if (reducedMotion || saveData || stopped || document.hidden) return;
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
      applyCopy(scene, index);
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
    const amount = Math.max(0, Math.min(1, Number(value) || 0));
    const percent = Math.round(amount * 100);
    if (message) status.textContent = message;
    percentage.textContent = `${percent}%`;
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
    for (const layer of layers) layer.removeAttribute('src');
    window.__loadingScreen = null;
  };

  const complete = () => {
    if (root.classList.contains('is-complete')) return;
    progress('Water is open', 1);
    stop();
    root.classList.add('is-complete');
    root.setAttribute('aria-hidden', 'true');
    completionTimer = window.setTimeout(() => { destroy(); root.remove(); }, 900);
  };

  const fail = (message) => {
    stop();
    root.classList.add('is-error');
    status.textContent = message;
  };

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
  applyCopy(LOADING_SCENES[initialIndex], initialIndex);
  refillSceneBag();
  scheduleNext();
  document.addEventListener('visibilitychange', onVisibilityChange);

  window.__loadingScreen = Object.freeze({ scenes: LOADING_SCENES, progress, stop, destroy, complete, fail });
}
