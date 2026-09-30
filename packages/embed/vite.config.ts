import { defineConfig } from 'vite-plus';

export default defineConfig({
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
    dts: {},
    exports: true,
  },
});
