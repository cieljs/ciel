import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    fileParallelism: false,
    sequence: { groupOrder: 2 },
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
    entry: ['src/index.ts', 'src/agent/index.ts'],
    dts: {},
    exports: true,
  },
});
