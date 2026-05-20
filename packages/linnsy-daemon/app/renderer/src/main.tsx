import React from 'react';
import { createRoot } from 'react-dom/client';

import { applyEarlyThemeMode } from './lib/early-theme.js';
import { AppShell } from './shell/AppShell.js';
import './styles/index.css';

applyEarlyThemeMode();

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing frontend root element');
}

createRoot(root).render(<AppShell />);
