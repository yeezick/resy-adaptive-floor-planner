import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:3001", "/healthz": "http://localhost:3001" } },
});
