import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './install'; // must load early so Chrome's install offer isn't missed
import './styles.css';

// Offline support and "Add to Home screen" (only in the built app, over HTTPS).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // After an update the service worker asks each open window if it is alive,
  // and reloads any that cannot answer (see reviveBrokenPages in sw.js).
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'ping') e.ports[0]?.postMessage('pong');
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
