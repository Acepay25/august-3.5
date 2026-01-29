
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

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

// Global state for SW update notification
let showUpdateNotification: (() => void) | null = null;
let waitingWorker: ServiceWorker | null = null;

export const setUpdateNotificationHandler = (handler: () => void) => {
  showUpdateNotification = handler;
};

export const activateWaitingWorker = () => {
  if (waitingWorker) {
    waitingWorker.postMessage('SKIP_WAITING');
  }
};

// --- Service Worker Registration ---
// Re-enabling Service Worker for offline functionality with a more robust registration strategy.
if ('serviceWorker' in navigator) {
  const registerServiceWorker = () => {
    const swUrl = `${window.location.origin}/sw.js`;

    navigator.serviceWorker.register(swUrl)
      .then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);

        // Check for updates on page load
        registration.update();

        // Listen for new service worker installing
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // New service worker is installed and waiting
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New service worker available, prompting for update...');
              waitingWorker = newWorker;
              if (showUpdateNotification) {
                showUpdateNotification();
              }
            }
          });
        });
      })
      .catch(err => {
        console.error('ServiceWorker registration failed: ', err);
      });

    // Handle controller change (when new SW takes over)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('New service worker activated, reloading...');
      window.location.reload();
    });
  };

  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker);
  }
}
// --- End of Service Worker Registration ---

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
