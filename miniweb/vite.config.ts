import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import packageJson from "./package.json";
// This function gets the IP that the Development server will point to from `local.config.ts`.
// To change your local IP create a file named `local.config.ts` in the same directory as vite.config.ts
// And contents:
// -------------------------------------------------
// const localConfig = { targetIp: '192.168.0.21' };
// export default localConfig;
// -------------------------------------------------
async function getDevelopmentIp() {
  const defaultTargetIp = "localhost";
  try {
    const localConfig = await import("./local.config");
    console.info(
      `Development server proxying to ${localConfig.default.targetIp}`,
    );
    return localConfig.default.targetIp;
  } catch (e) {
    console.info(
      `Did not find local_config.ts file. IP will default to ${defaultTargetIp}`,
    );
    return defaultTargetIp;
  }
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  server: {
    proxy: {
      "/api": {
        target: `http://${await getDevelopmentIp()}`,
        changeOrigin: true,
        secure: false,
      },
      "/ws": {
        target: `ws://${await getDevelopmentIp()}`,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
    host: "localhost",
    port: 3000,
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    preact(),
    // viteTsconfigPaths(),
    // svgrPlugin(),
    // viteCompression(),
  ],
  build: {
    outDir: "../data",
    emptyOutDir: true,
  },
}));
