import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    fileParallelism: false,
  },
  run: {
    tasks: {
      build: {
        command: 'vp pack',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      test: {
        command: 'vp test',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: {
    dts: {},
    exports: true,
  },
});
