import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

const box = "https://le6-3-34virmire.pulsedmedia.com";
const { LIONTORRENT_USER: user, LIONTORRENT_PASS: pass } = process.env;

export default defineConfig({
  base: "./",
  plugins: [solid()],
  resolve: { alias: { "@sealion/ui": path.resolve("../page-mountain-lion/sealion") } },
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/rpc": {
        target: box,
        changeOrigin: true,
        rewrite: () => "/user-kitan/rutorrent/plugins/rpc/rpc.php",
        headers: user && pass
          ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }
          : {},
      },
      "/fm": {
        target: box,
        changeOrigin: true,
        rewrite: (p) => "/user-kitan/rutorrent/plugins/filemanager" + p.replace(/^\/fm/, ""),
        headers: user && pass
          ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }
          : {},
      },
    },
  },
});
