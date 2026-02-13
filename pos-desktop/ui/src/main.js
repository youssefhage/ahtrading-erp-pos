import './styles.css';
import App from './App.runtime.js';

const mount = document.getElementById('app');
if (mount && typeof App === 'function') {
  App(mount);
}
