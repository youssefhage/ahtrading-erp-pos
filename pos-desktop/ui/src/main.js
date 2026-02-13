import './styles.css';
import App from './App.runtime.js';

const mount = document.getElementById('app') || document.body;
if (mount && typeof App === 'function') {
  App(mount);
}
