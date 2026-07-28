
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';

// Self-hosted fonts (offline-capable, no external CDN dependency)
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

// --- Global Error Handlers ---
// Catch unhandled Promise rejections (common issue on Android WebView)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled Promise rejection:', event.reason);
  // Prevent the error from bubbling and causing a crash
  event.preventDefault();

  // Store for debugging
  try {
    const errorLog = {
      timestamp: new Date().toISOString(),
      type: 'unhandledrejection',
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack
    };
    localStorage.setItem('lastPromiseError', JSON.stringify(errorLog));
  } catch (e) {
    // Ignore storage errors
  }
});

// Catch global JavaScript errors
window.addEventListener('error', (event) => {
  console.error('[Global] Uncaught error:', event.error);

  try {
    const errorLog = {
      timestamp: new Date().toISOString(),
      type: 'error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    };
    localStorage.setItem('lastGlobalError', JSON.stringify(errorLog));
  } catch (e) {
    // Ignore storage errors
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
