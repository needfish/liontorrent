import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const box = env.LIONTORRENT_BOX ?? "";
  const user = env.LIONTORRENT_USER, pass = env.LIONTORRENT_PASS;
  const auth = user && pass
    ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }
    : {};

  return {
    base: "./",
    plugins: [solid()],
    resolve: { alias: { "@sealion/ui": path.resolve("./vendor/sealion") } },
    server: {
      fs: { allow: [".."] },
      proxy: {
        "/rpc": {
          target: box,
          changeOrigin: true,
          rewrite: () => "/user-kitan/rutorrent/plugins/rpc/rpc.php",
          headers: auth,
        },
      },
    },
  };
});
