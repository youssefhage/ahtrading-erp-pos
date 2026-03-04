import './styles.css';
import App from './App.svelte';
import { mount } from 'svelte';

const mountTarget = document.getElementById('app') || document.body;

if (mountTarget) {
  mount(App, { target: mountTarget });
}

// Register service worker for offline support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for SW updates periodically (every 60 minutes).
        setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);

        // When a new SW is found and activates, reload the page so the
        // user gets the latest cached assets.  Only reload if the page
        // isn't in the middle of a checkout (check for the loading overlay).
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
              // New SW is active — a controlled reload picks up new assets.
              // Don't reload if a checkout spinner is visible (avoid losing state).
              const spinner = document.querySelector('[data-loading-overlay]');
              if (!spinner) {
                window.location.reload();
              }
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[POS] Service worker registration failed:', err);
      });
  });
}
