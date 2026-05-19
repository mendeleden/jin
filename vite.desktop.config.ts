import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  build: {
    rollupOptions: {
      input: "desktop/index.dev.html",
    },
  },
  clearScreen: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: false,
  },
});
