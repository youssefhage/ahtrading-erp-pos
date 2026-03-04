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
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[POS] Service worker registration failed:', err);
    });
  });
}
