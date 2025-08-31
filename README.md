# Committy

Smart git commit assistant powered by OpenAI that analyzes your changes and suggests meaningful commit messages.

## Features

- **Smart Analysis**: Uses OpenAI to analyze git diffs and generate contextual commit messages
- **Interactive Workflow**: Guides you through staging changes and reviewing commit messages
- **Change Grouping**: Automatically groups related changes into logical commits
- **Flexible Staging**: Stage individual hunks or entire files
- **Message Editing**: Edit generated messages or regenerate them as needed
- **Environment Config**: Supports custom OpenAI endpoints and API keys

## Installation

Install globally via npm:

```bash
npm install -g committy
```

Or install locally:

```bash
npm install committy
```

## Configuration

Set up your OpenAI API key:

```bash
export COMMITTY_OPENAI_API_KEY=your_openai_api_key
```

Or use the standard OpenAI environment variable:

```bash
export OPENAI_API_KEY=your_openai_api_key
```

For custom OpenAI endpoints (optional):

```bash
export COMMITTY_OPENAI_BASE_URL=https://your-custom-endpoint.com
export OPENAI_BASE_URL=https://your-custom-endpoint.com
```

## Usage

1. Navigate to your git repository
2. Run `committy`
3. Follow the interactive prompts

The tool will:
1. First handle any staged changes and generate a commit message
2. Then analyze unstaged changes and group them by topic
3. Ask you to confirm staging each group
4. Generate a commit message for each staged group
5. Allow you to edit or regenerate messages before committing

## How It Works

1. **Staged Changes**: If you have staged changes, committy will generate a commit message for them first
2. **Unstaged Changes**: Analyzes unstaged changes and groups them by topic using AI
3. **Interactive Review**: Shows you a preview of each group and asks if you want to stage it
4. **Message Generation**: Generates a concise commit message for each group
5. **Editing Options**: Allows you to edit messages, regenerate them, or use them as-is

## Requirements

- Node.js >= 14.0.0
- Git repository
- OpenAI API key

## License

ISC