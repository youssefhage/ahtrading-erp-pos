import './styles.css';
import App from './App.svelte';
import { mount } from 'svelte';

const mountTarget = document.getElementById('app') || document.body;

if (mountTarget) {
  mount(App, { target: mountTarget });
}
