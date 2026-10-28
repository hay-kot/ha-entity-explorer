import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Home Assistant serves this directory through the integration's static path.
    outDir: "../custom_components/entity_explorer/frontend",
    emptyOutDir: true,
    lib: {
      entry: "src/entity-explorer-panel.ts",
      formats: ["es"],
      fileName: () => "entity-explorer.js",
    },
  },
});
