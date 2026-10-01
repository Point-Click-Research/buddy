import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { SettingsProvider } from './context';
import { App } from './App';
import { releaseFocusOnBlur } from '../shared/release-focus';

const root = document.getElementById('root');
if (!root) throw new Error('settings root missing');
releaseFocusOnBlur();
// The window has vibrancy (windows.ts): the canvas paints over the blur.
document.body.classList.add('translucent');
createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
