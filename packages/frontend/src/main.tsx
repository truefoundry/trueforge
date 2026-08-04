import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installApiErrorInterceptor } from './apiErrors';
import { App } from './App';
import './index.css';

installApiErrorInterceptor();

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
