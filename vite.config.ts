import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API_PORT lets a second checkout run its own API server beside the default one.
const api = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/api": api, "/healthz": api } },
});
