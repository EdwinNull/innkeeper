import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const shared = { '@shared': resolve('src/shared') };

/** 只在打包时注入，开发服务器需要内联脚本做热更新 */
const csp: Plugin = {
  name: 'innkeeper-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      injectTo: 'head-prepend',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: innkeeper:; media-src data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      },
    },
  ],
};

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      // 所有运行时依赖都打进一个包，安装包里不需要 node_modules
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          tavern: resolve('src/preload/tavern.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), csp],
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') },
      chunkSizeWarningLimit: 2000,
    },
  },
});
