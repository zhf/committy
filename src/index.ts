#!/usr/bin/env node

import chalk from 'chalk';
import { loadConfig } from './openai';
import { handleStagedChanges, handleUnstagedChanges } from './interactive';

async function main() {
  try {
    console.log(chalk.green.bold('\ncommitty — smart commit assistant\n'));

    const config = loadConfig();

    await handleStagedChanges(config);
    await handleUnstagedChanges(config);

    console.log(chalk.green.bold('\nAll done. 🎉'));
  } catch (err: any) {
    console.error(chalk.red('committy failed:'), err);
    process.exit(1);
  }
}

main();