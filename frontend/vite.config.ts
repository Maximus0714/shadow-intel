import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = {
  "/api": {
    target: process.env.API_PROXY_TARGET || "http://127.0.0.1:8019",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("cytoscape-cola") || id.includes("webcola")) return "graph-layout-vendor";
          if (id.includes("node_modules/cytoscape")) return "graph-vendor";
          if (id.includes("xlsx")) return "spreadsheet-vendor";
          if (id.includes("@supabase")) return "supabase-vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy,
  },
  preview: { proxy },
});
