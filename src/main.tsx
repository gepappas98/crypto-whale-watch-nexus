import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import { installChunkRecovery } from './lib/chunkRecovery';
import { installStartupDiagnostics } from './lib/startupDiagnostics';
import { installDebugOverlay } from './lib/debugOverlay';
import './index.css';

// Install BEFORE anything else so we catch failures from the very first import.
installDebugOverlay();
installChunkRecovery();
installStartupDiagnostics();

async function bootstrap() {
  try {
    await registerServiceWorker();
  } catch (err) {
    console.warn('[bootstrap] service worker registration failed:', err);
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    console.error('[bootstrap] #root not found in DOM');
    return;
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
