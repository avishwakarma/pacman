// Loads a local LLM in-browser via WebLLM (MLC AI). This already works out
// of the box — Stage 3 wires the chat panel to call it and to register
// WebMCP tools the model can invoke.
//
// Model choice: WebLLM only supports OpenAI-style tool-calling (the
// `tools` param in engine.chat.completions.create) on a specific allowlist
// of Hermes-family models — small models like Llama 3.2 1B throw "not
// supported for ChatCompletionRequest.tools" if you pass `tools` at all.
// Hermes-2-Pro-Llama-3-8B is the broadest-compatible option on that list
// (~5GB — see SETUP.md for the download-size tradeoff and why the smaller
// Mistral-7B variant isn't used instead: it needs the shader-f16 GPU
// feature specifically, which not every laptop in the room will have).
import { CreateMLCEngine } from '@mlc-ai/web-llm';

export const MODEL_ID = 'Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC';

// onProgress(fraction, text): fires repeatedly while the (multi-hundred-MB+)
// model weights download and get cached, so the caller can render a
// progress bar instead of a page that looks hung. CreateMLCEngine resolves
// once the model is fully loaded and ready to serve completions.
export async function loadModel(onProgress) {
  return CreateMLCEngine(MODEL_ID, {
    initProgressCallback: (report) => onProgress?.(report.progress, report.text),
  });
}
