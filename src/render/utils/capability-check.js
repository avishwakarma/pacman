// WebGPU support check, run before picking a renderer. The caller
// (chooseRenderer in main.js on the webgpu branch) uses this to decide
// between webgpu-renderer.js and the Canvas 2D fallback in
// canvas-renderer.js — Canvas 2D always works, so a failure here is never
// fatal to the game, only to which renderer draws it. Kept as its own tiny
// module (rather than folded into webgpu-renderer.js) so that module can
// assume WebGPU is available and never has to defend against a missing
// `navigator.gpu` itself.
//
// `navigator.gpu` existing only means the browser shipped the API surface;
// it says nothing about whether there's an actual GPU behind it. A device
// with no compatible GPU, GPU drivers too old, or a GPU on the browser's
// blocklist all still have `navigator.gpu`, but `requestAdapter()` resolves
// to `null` for all of them — so requesting an adapter, not the property
// check, is the real test. This only goes as far as the adapter, not
// `adapter.requestDevice()` (the next step, done in webgpu-renderer.js's
// initRenderer): that call has its own failure mode and is already wrapped
// in its own try/catch at the call site, so duplicating that here would
// just be two places doing the same fallback dance. See SETUP.md for the
// exact Chrome version/flag this needs.

export async function checkWebGPUSupport() {
  if (!('gpu' in navigator)) {
    return { supported: false, reason: 'navigator.gpu is not available in this browser' };
  }

  try {
    // requestAdapter() can resolve null (no matching GPU) rather than
    // reject, so both outcomes need handling — the try/catch alone isn't
    // enough. Some environments (older browser versions, certain
    // permission-restricted contexts) throw instead, hence catching too.
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No WebGPU adapter available on this device' };
    }
    // The adapter is returned, not discarded, so the caller can hand it
    // straight to initRenderer(canvas, adapter) — requesting a second
    // adapter there would be redundant work and isn't guaranteed to return
    // the same one.
    return { supported: true, adapter };
  } catch (err) {
    return { supported: false, reason: `WebGPU adapter request failed: ${err.message}` };
  }
}
