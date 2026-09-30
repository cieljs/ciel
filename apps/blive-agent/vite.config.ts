import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  veldora: {
    main: {
      filterConsole: line => line.includes('Failed to resolve address'),
    },
    preload: {
      build: {
        externalizeDeps: false,
        rollupOptions: {
          output: {
            format: 'es',
            entryFileNames: 'index.mjs',
          },
        },
      },
    },
    renderer: {
      plugins: [
        tailwindcss(),
        vue({
          template: {
            compilerOptions: {
              isCustomElement: tag => tag === 'webview',
            },
          },
        }),
      ],
    },
  },
  run: {
    tasks: {
      'typecheck:node': {
        command: 'tsc --noEmit -p tsconfig.node.json --composite false',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      'typecheck:web': {
        command: 'vue-tsc --noEmit -p tsconfig.web.json --composite false',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      typecheck: {
        command: ['vpr typecheck:node', 'vpr typecheck:web'],
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      start: {
        command: 'vld preview',
        cache: false,
      },
      dev: {
        command: 'vld dev',
        cache: false,
        dependsOn: ['build'],
      },
      build: {
        command: 'vld build',
        dependsOn: ['typecheck'],
      },
      postinstall: 'electron-builder install-app-deps',
      'build:unpack': {
        command: 'electron-builder --dir',
        dependsOn: ['build'],
        cache: false,
      },
      'build:win': {
        command: 'electron-builder --win',
        dependsOn: ['build'],
        cache: false,
      },
      'build:mac': {
        command: 'electron-builder --mac',
        dependsOn: ['build'],
        cache: false,
      },
      'build:linux': {
        command: 'electron-builder --linux',
        dependsOn: ['build'],
        cache: false,
      },
    },
  },
});
