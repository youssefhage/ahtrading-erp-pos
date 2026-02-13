import './styles.css';
import App from './App.svelte';

const mount = document.getElementById('app') || document.body;

if (mount) {
  new App({
    target: mount,
  });
}
