import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const app = new App();
document.body.innerHTML = app.render();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);