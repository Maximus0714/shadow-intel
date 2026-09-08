import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8000",
      "/stats": "http://127.0.0.1:8000",
      "/graph": "http://127.0.0.1:8000",
      "/entities": "http://127.0.0.1:8000",
      "/analytics": "http://127.0.0.1:8000",
      "/search": "http://127.0.0.1:8000",
      "/documents": "http://127.0.0.1:8000",
      "/ingest": "http://127.0.0.1:8000",
    },
  },
});
