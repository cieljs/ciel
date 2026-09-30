#!/usr/bin/env node

import { installModel } from './model.ts';
import { createVoiceprint } from './voiceprint.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--') {
    args.shift();
  }

  const command = args.shift();

  if (args[0] === '--') {
    args.shift();
  }

  switch (command) {
    case 'install-model': {
      await installModel(args);

      return;
    }

    case 'voiceprint': {
      await createVoiceprint(args);

      return;
    }

    case undefined:
    case 'help':
    case '--help':

    case '-h': {
      printHelp();

      return;
    }

    default: {
      printHelp();
      process.exitCode = 2;
    }
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: hearing <command> [options]',
      '',
      'Commands:',
      '  install-model  Install speech models',
      '  voiceprint     Create a voiceprint from WAV samples',
      '',
    ].join('\n'),
  );
}

await main();
