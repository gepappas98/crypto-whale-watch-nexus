import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import { installChunkRecovery } from './lib/chunkRecovery';
import './index.css';

// Install BEFORE anything else so we catch failures from the very first import.
installChunkRecovery();

async function bootstrap() {
  await registerServiceWorker();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
