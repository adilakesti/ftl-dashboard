import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mockApi from "./mock/mockApi.js";

// `npm run dev:mock` (vite --mode mock) serves a fake /api with sample data for local
// UI work — no backend or database needed. Otherwise /api is proxied to the backend.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "mock" ? [mockApi()] : [])],
  server: mode === "mock" ? {} : { proxy: { "/api": "http://localhost:8000" } },
}));
