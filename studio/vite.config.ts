import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

function preferStylesheetsFirst() {
  return {
    name: "prefer-stylesheets-first",
    transformIndexHtml(html: string) {
      // Keep Studio CSS ahead of module scripts so the shell is styled before React boots.
      return html.replace(
        /(<script type="module"[^>]*><\/script>\s*)(<link rel="stylesheet"[^>]*>)/,
        "$2\n    $1",
      );
    },
  };
}

export default defineConfig({
  base: "/meridian/consent-studio/",
  plugins: [react(), preferStylesheetsFirst()],
  build: {
    outDir: fileURLToPath(new URL("../public/meridian/consent-studio", import.meta.url)),
    emptyOutDir: true,
  },
});
