import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "/meridian/consent-studio/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../public/meridian/consent-studio", import.meta.url)),
    emptyOutDir: true,
  },
});
