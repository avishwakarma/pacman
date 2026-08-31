// Loads a small local LLM in-browser via WebLLM (MLC AI). This already
// works out of the box — Stage 2 wires the chat panel to call it and to
// register WebMCP tools the model can invoke.
//
// Model choice: Llama 3.2 1B Instruct, quantized, picked for fast download
// on conference wifi. Swap MODEL_ID for a different WebLLM prebuilt model
// if you want to experiment (see SETUP.md for the tradeoffs). Note this
// particular model is instruct-only, not one of WebLLM's tool-calling
// allowlist — passing `tools` to it throws. A later stage swaps MODEL_ID
// to a Hermes-family model specifically to unlock ai/tool-loop.js's
// `tools` param (see that file for the quirks that swap brings with it).

import { CreateMLCEngine } from '@mlc-ai/web-llm';

export const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// onProgress(fraction, text): fires repeatedly while the (multi-hundred-MB+)
// model weights download and get cached, so the caller can render a
// progress bar instead of a page that looks hung. CreateMLCEngine resolves
// once the model is fully loaded and ready to serve completions.
export async function loadModel(onProgress) {
  return CreateMLCEngine(MODEL_ID, {
    initProgressCallback: (report) => onProgress?.(report.progress, report.text),
  });
}
