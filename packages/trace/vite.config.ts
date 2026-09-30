import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    fileParallelism: false,
    sequence: { groupOrder: 1 },
  },
  run: {
    tasks: {
      build: {
        command: 'vp pack',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      test: {
        command: 'vp test',
        dependsOn: [{ task: 'build', from: ['dependencies', 'devDependencies'] }],
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: {
    entry: {
      index: 'src/index.ts',
      host: 'src/host/index.ts',
      client: 'src/client/index.ts',
      protocol: 'src/protocol/index.ts',
    },
    dts: true,
    exports: false,
  },
});
