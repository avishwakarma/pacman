// Renders the #model-status card. Split out of main.js so this
// presentational chunk (three DOM-building functions, no logic of its
// own) doesn't crowd out the actual model-loading wiring in main.js —
// this file is unused on this branch, `webmcp` is the first branch that
// calls into it.

import { MODEL_ID } from './llm-loader.js';

const modelStatus = document.getElementById('model-status');

// The model-status card has two distinct layouts (loading vs. loaded), not
// just different colors on the same markup, so it's rebuilt via innerHTML
// on each state change rather than juggling several conditionally-hidden
// sub-elements.
export function renderModelStatusLoading(progress, text) {
  modelStatus.className = 'loading';
  modelStatus.innerHTML = `
    <div id="model-status-header">
      <span id="model-status-title">LOCAL MODEL</span>
      <span id="model-status-percent">${Math.round(progress * 100)}%</span>
    </div>
    <div id="model-status-text">${text || 'Loading, please wait…'}</div>
    <div id="model-status-meta">${MODEL_ID}</div>
  `;
}

export function renderModelStatusLoaded() {
  modelStatus.className = 'loaded';
  modelStatus.innerHTML = `
    <div id="model-status-header">
      <span id="model-status-title">LOCAL MODEL LOADED</span>
      <img src="/icons/check-check.svg" alt="" />
    </div>
    <div id="model-status-meta">${MODEL_ID}</div>
  `;
}

export function renderModelStatusError(message) {
  modelStatus.className = 'error';
  modelStatus.innerHTML = `
    <div id="model-status-header">
      <span id="model-status-title">MODEL FAILED TO LOAD</span>
    </div>
    <div id="model-status-text">${message}</div>
  `;
}
