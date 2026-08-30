import './loading-screen.js';

const loaderOnly = new URLSearchParams(window.location.search).has('loaderOnly');

if (loaderOnly) {
  document.documentElement.dataset.loaderOnly = 'true';
  window.__loadingScreen?.progress?.('Holding at the fish camp', 0.64);
} else {
  import('./main.js').catch(error => {
    console.error(error);
    window.__loadingScreen?.fail?.('The launch motor quit. Reload and try again.');
  });
}
