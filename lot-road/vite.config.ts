import { defineConfig } from "vite";

// Served at battydev.com/MobileSlopGame/. The built files are committed
// to that folder; there is no second host and no client router.
export default defineConfig({
  base: "/MobileSlopGame/",
  build: {
    outDir: "../MobileSlopGame",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
