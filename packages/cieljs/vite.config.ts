import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'vp pack && node ./scripts/copy-styles.mjs',
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
      'agent-kit': 'src/agent-kit.ts',
      storage: 'src/storage.ts',
      session: 'src/session.ts',
      'session/agent': 'src/session/agent.ts',
      memory: 'src/memory.ts',
      'memory/agent': 'src/memory/agent.ts',
      vector: 'src/vector.ts',
      mcp: 'src/mcp.ts',
      'model-kit': 'src/model-kit.ts',
      'model-kit/models': 'src/model-kit/models.ts',
      embed: 'src/embed.ts',
      hearing: 'src/hearing.ts',
      perception: 'src/perception.ts',
      runtime: 'src/runtime.ts',
      trace: 'src/trace.ts',
      'trace/host': 'src/trace/host.ts',
      'trace/client': 'src/trace/client.ts',
      'trace/protocol': 'src/trace/protocol.ts',
      console: 'src/console.ts',
      investigation: 'src/investigation.ts',
    },
    dts: {},
    exports: false,
  },
});
