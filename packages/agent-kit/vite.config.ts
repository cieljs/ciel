import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'vp pack',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
      test: {
        command: 'vp test --passWithNoTests',
        dependsOn: [{ task: 'build', from: ['dependencies', 'devDependencies'] }],
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: {
    entry: ['src/index.ts', 'src/protocol.ts'],
    dts: {},
    exports: true,
  },
});
