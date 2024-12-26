
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// This function gets the IP that the Development server will point to from `local.config.ts`.
// To change your local IP create a file named `local.config.ts` in the same directory as vite.config.ts
// And contents:
// -------------------------------------------------
// const localConfig = { targetIp: '192.168.0.21' };
// export default localConfig;
// -------------------------------------------------
async function getDevelopmentIp() {
  const defaultTargetIp = 'localhost';
  try {
    const localConfig = await import('./local.config');
    console.info(`Development server proxying to ${localConfig.default.targetIp}`);
    return localConfig.default.targetIp;
  } catch (e) {
    console.info(`Did not find local_config.ts file. IP will default to ${defaultTargetIp}`);
    return defaultTargetIp;
  }
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  server: {
    proxy: {
      '/api': {
        target: `http://${await getDevelopmentIp()}`,
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: `ws://${await getDevelopmentIp()}`,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
    host: '0.0.0.0',
    port: 3000,
  },
  plugins: [
    // react(),
    // viteTsconfigPaths(),
    // svgrPlugin(),
    // viteCompression(),
		svelte(),

    VitePWA({
    //   registerType: 'autoUpdate',
    //   workbox: {
    //     clientsClaim: true,
    //     skipWaiting: true,
    //   },
      manifest: {
        short_name: 'Yaeger',
        name: 'Yaeger web portal',
        protocol_handlers: [
          {
            protocol: 'web+http',
            url: '/',
          },
        ],
        icons: [
          {
            src: 'favicon.png',
            sizes: '64x64 32x32 24x24 16x16',
            type: 'image/png',
          },
          {
            src: 'logo.png',
            sizes: 'any',
            type: 'image/png',
          },
          {
            src: 'splash.png',
            sizes: 'any',
            type: 'image/png',
          },
        ],
        start_url: '/',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#ffffff',
      },
      manifestFilename: 'manifest.json',
      injectRegister: null, // Disable SW registration for now
      // registerType: 'autoUpdate',
    }),
  ],
  build: {
    outDir: '../data',
    emptyOutDir: true,
  },
}));
