import { defineConfig } from "vite";

// Served at battydev.com/mobileslopgame/. The built files are committed
// to that folder; there is no second host and no client router.
// The mixed-case folder only redirects here, so an old link still lands.
export default defineConfig({
  base: "/mobileslopgame/",
  build: {
    outDir: "../mobileslopgame",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
