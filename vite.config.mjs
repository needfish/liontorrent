import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const box = "https://le6-3-34virmire.pulsedmedia.com";
  const user = env.LIONTORRENT_USER, pass = env.LIONTORRENT_PASS;
  const auth = user && pass
    ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }
    : {};

  return {
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
          headers: auth,
        },
        "/user-kitan": {
          target: box,
          changeOrigin: true,
          headers: auth,
        },
      },
    },
  };
});
