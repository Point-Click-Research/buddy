import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import './home.css';
import { App } from './App';
import { DragCard, dragCardList } from './DragCard';
import { releaseFocusOnBlur } from '../shared/release-focus';

const root = document.getElementById('root');
if (!root) throw new Error('home root missing');
releaseFocusOnBlur();
// The same bundle serves the floating drag card (windows.ts opens it on a
// hash), so the walk's permissions step needs no page of its own.
const list = dragCardList(window.location.hash);
// The window has vibrancy (windows.ts): the canvas paints over the blur. The
// card's window is transparent instead, and paints only the card.
document.body.classList.add(list ? 'clear' : 'translucent');
createRoot(root).render(<StrictMode>{list ? <DragCard list={list} /> : <App />}</StrictMode>);
