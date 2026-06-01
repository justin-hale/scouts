import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `base` matters for GitHub Pages project sites served from /<repo>/.
// Set VITE_BASE in the deploy workflow (e.g. "/scouts/"). Defaults to "/" for local dev.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
});
