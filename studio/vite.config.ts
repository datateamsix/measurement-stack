import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

function inlineStudioCss(): Plugin {
  return {
    name: "inline-studio-css",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        // Inline the built stylesheet so Studio cannot render unstyled if the CSS asset
        // request is blocked, cached incorrectly, or delayed behind Access.
        const match = html.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/);
        if (!match) return html;
        const href = match[1];
        const fileName = href.split("/").pop();
        if (!fileName || !ctx.bundle) return html;
        const asset = Object.values(ctx.bundle).find((item) => {
          return item.type === "asset" && item.fileName.endsWith(fileName);
        });
        if (!asset || asset.type !== "asset" || typeof asset.source !== "string") return html;
        return html.replace(match[0], `<style data-studio-css>${asset.source}</style>`);
      },
    },
  };
}

export default defineConfig({
  base: "/meridian/consent-studio/",
  plugins: [react(), inlineStudioCss()],
  build: {
    outDir: fileURLToPath(new URL("../public/meridian/consent-studio", import.meta.url)),
    emptyOutDir: true,
  },
});
