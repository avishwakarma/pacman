import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // WebGPU and WebMCP both require a secure context; localhost counts,
    // so no HTTPS setup is needed for the workshop.
    open: true,
  },
});
