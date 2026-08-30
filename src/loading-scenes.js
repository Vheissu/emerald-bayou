export const LOADING_SCENES = Object.freeze([
  Object.freeze({
    id: 'gator-overtime',
    src: 'loading/gator-overtime.webp',
    title: 'Gator overtime',
    note: 'Everybody clocked out except the gator.',
    district: 'Sawgrass Landing',
    accent: '#e7a34d',
    position: 'center center',
    mobilePosition: '72% center',
  }),
  Object.freeze({
    id: 'dockside-trouble',
    src: 'loading/dockside-trouble.webp',
    title: 'Dockside trouble',
    note: 'She charges extra if you ask what sank.',
    district: 'Cypress Hook',
    accent: '#e06a56',
    position: 'center center',
    mobilePosition: '73% center',
  }),
  Object.freeze({
    id: 'blue-water',
    src: 'loading/blue-water.webp',
    title: 'Blue water',
    note: 'The cut gets narrow when the sirens start.',
    district: 'Blackwater Cut',
    accent: '#71b6e4',
    position: 'center center',
    mobilePosition: '75% center',
  }),
  Object.freeze({
    id: 'pressure-drop',
    src: 'loading/pressure-drop.webp',
    title: 'Pressure drop',
    note: 'The lawn chairs left before the locals did.',
    district: 'Mangrove Reach',
    accent: '#cad17a',
    position: 'center center',
    mobilePosition: '74% center',
  }),
  Object.freeze({
    id: 'redline-run',
    src: 'loading/redline-run.webp',
    title: 'Redline run',
    note: 'The smart money stayed at the dock.',
    district: 'Redgrass Cut',
    accent: '#f0a55c',
    position: 'center center',
    mobilePosition: '72% center',
  }),
  Object.freeze({
    id: 'midnight-pickup',
    src: 'loading/midnight-pickup.webp',
    title: 'Midnight pickup',
    note: "The cooler's cold. The cash isn't.",
    district: 'Oyster Key',
    accent: '#b888ef',
    position: 'center center',
    mobilePosition: '73% center',
  }),
]);

const randomIndex = (length, random) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * length));

export function initialLoadingSceneIndex({ requested = '', saveData = false, random = Math.random } = {}) {
  const requestedIndex = LOADING_SCENES.findIndex(scene => scene.id === requested);
  if (requestedIndex >= 0) return requestedIndex;
  return saveData ? 0 : randomIndex(LOADING_SCENES.length, random);
}

export function shuffledLoadingSceneIndices(currentIndex = -1, random = Math.random) {
  const indices = LOADING_SCENES.map((_, index) => index).filter(index => index !== currentIndex);
  for (let index = indices.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1, random);
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}

export function loadingAssetUrl(src, baseUrl) {
  return new URL(src, baseUrl).href;
}
