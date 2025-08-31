import { prompt } from 'enquirer';
import ora from 'ora';
import chalk from 'chalk';
import { GitConfig } from './types';
import { ChangeItem, TopicGroup } from './types';
import { renderSimpleTable, renderBox, openInExternalEditor } from './utils';
import { generateCommitMessage, clusterChanges } from './openai';
import { stageItems, getStagedDiff, commitWithMessage, unstageFiles, collectUnstagedChanges, getStagedFiles } from './git';

export async function editOrRegenerate(
  initial: string,
  regenerateFn: () => Promise<string>
): Promise<string> {
  while (true) {
    console.log(chalk.blue('\nGenerated commit message:'));
    console.log(renderBox(initial));
    
    const resp = await prompt({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'commit', message: 'Use this message and commit' },
        { name: 'edit', message: 'Edit message in $EDITOR (multi-line)' },
        { name: 'regenerate', message: 'Regenerate (ask model again)' },
        { name: 'abort', message: 'Abort' },
      ],
    }) as any;

    if (resp.action === 'commit') {
      return initial;
    } else if (resp.action === 'edit') {
      const edited = await openInExternalEditor(initial);
      if (edited === null) {
        console.log(chalk.yellow('Edit cancelled; keeping previous.'));
      } else if (edited && edited.trim()) {
        initial = edited.trim();
        continue;
      } else {
        console.log(chalk.yellow('Empty message not allowed; keeping previous.'));
      }
    } else if (resp.action === 'regenerate') {
      const spinner = ora('Regenerating commit message...').start();
      try {
        const msg = await regenerateFn();
        spinner.succeed('Regenerated.');
        initial = msg;
      } catch (err: any) {
        spinner.fail('Regeneration failed: ' + String(err?.message || err));
      }
    } else if (resp.action === 'abort') {
      throw new Error('Aborted by user');
    }
  }
}

export async function handleStagedChanges(config: GitConfig): Promise<void> {
  const stagedNames = await getStagedFiles();
  
  if (stagedNames.length === 0) {
    return;
  }

  console.log(chalk.cyan('Detected staged changes — generating commit message first...\n'));
  const stagedPatch = await getStagedDiff();
  
  const spinner = ora('Generating commit message...').start();
  try {
    const generated = await generateCommitMessage(config, stagedPatch, false);
    spinner.succeed('Generated commit message.');
    
    const finalMsg = await editOrRegenerate(generated, async () => {
      return await generateCommitMessage(config, stagedPatch, false);
    });
    
    await commitWithMessage(finalMsg);
    console.log(chalk.green('Committed staged changes.'));
  } catch (err: any) {
    spinner.fail('Failed to generate commit message: ' + String(err?.message || err));
  }
}

export async function handleUnstagedChanges(config: GitConfig): Promise<void> {
  while (true) {
    const items = await collectUnstagedChanges();
    if (items.length === 0) {
      console.log(chalk.green('\nNo unstaged/untracked changes left. Done.'));
      break;
    }

    console.log(chalk.cyan(`\nFound ${items.length} unstaged/untracked change items.`));

    const spinnerCluster = ora('Grouping changes into topics...').start();
    let groups: TopicGroup[] = [];
    
    try {
      groups = await clusterChanges(config, items);
      spinnerCluster.succeed(`Grouped into ${groups.length} topics:`);
      
      // Display the topics
      groups.forEach((group, index) => {
        console.log(chalk.dim(`  ${index + 1}. ${group.topic} (${group.items.length} items)`));
      });
    } catch (err: any) {
      spinnerCluster.fail('Grouping failed: ' + String(err));
      groups = items.map(it => ({ topic: `${it.file}`, items: [it.id] }));
    }

    const itemMap = new Map(items.map(i => [i.id, i]));
    
    for (const g of groups) {
      const groupItems = g.items.map(id => itemMap.get(id)).filter(Boolean) as ChangeItem[];
      
      console.log(chalk.yellow('\n---'));
      console.log(chalk.bold(`Topic: ${g.topic}`));
      console.log(chalk.dim('(Preview of the group changes)'));

      const headers = [chalk.bold('File'), chalk.bold('Kind'), chalk.bold('Preview')];
      const rows = groupItems.map(it => [
        it.file,
        it.kind,
        (it.preview || it.patch || '').split('\n').slice(0, 2).join(' ')
      ]);

      const table = renderSimpleTable(headers, rows, { columnMaxWidths: [40, 8] });
      console.log(table);
      console.log(chalk.yellow('---'));

      const confirmResp = await prompt({
        type: 'confirm',
        name: 'stage',
        message: `Stage these ${groupItems.length} changes for commit?`,
        initial: true,
      }) as any;
      const confirm = confirmResp.stage as boolean;

      if (!confirm) {
        console.log(chalk.gray('Skipping this group for now.'));
        continue;
      }

      const spinnerStage = ora('Staging selected changes...').start();
      try {
        await stageItems(groupItems);
        spinnerStage.succeed('Staged.');
      } catch (err: any) {
        spinnerStage.fail('Staging failed: ' + String(err?.message || err));
        continue;
      }

      const stagedPatch = await getStagedDiff();
      let oneLine = '';
      
      try {
        const spinnerGen = ora('Generating one-line commit subject...').start();
        oneLine = await generateCommitMessage(config, stagedPatch, true);
        spinnerGen.succeed('Generated one-liner.');
      } catch (err: any) {
        console.warn(chalk.yellow('Commit message generation failed: ' + String(err?.message || err)));
        oneLine = `${g.topic}`;
      }

      let finalMsg = '';
      try {
        finalMsg = await editOrRegenerate(oneLine, async () => {
          return await generateCommitMessage(config, stagedPatch, true);
        });
      } catch (err: any) {
        console.log(chalk.red('Aborted by user. Unstaging what we just staged.'));
        try {
          const files = Array.from(new Set(groupItems.map(it => it.file)));
          await unstageFiles(files);
        } catch (_) {}
        process.exit(1);
      }

      try {
        await commitWithMessage(finalMsg);
        console.log(chalk.green(`Committed: ${finalMsg}`));
      } catch (err: any) {
        console.error(chalk.red('git commit failed: ' + String(err?.message || err)));
      }
    }
  }
}