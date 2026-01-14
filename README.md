# GemKit CLI

A command-line interface for working with Gemini AI agents, plans, and sessions.

![Demo](public/demo-final.gif)

## Installation

```bash
npm install -g gemkit-cli
```

## Usage

```bash
gk <command> [options]
```

### Global Options

- `--verbose` - Enable verbose output
- `--json` - Output as JSON
- `--help` - Show help
- `--version` - Show version

### Commands

| Command | Description |
|---------|-------------|
| `gk init` | Initialize GemKit in your project |
| `gk new` | Create new agents, plans, or skills |
| `gk agent` | Manage and spawn AI agents |
| `gk session` | View and manage sessions |
| `gk plan` | Work with execution plans |
| `gk tokens` | Analyze token usage and costs |
| `gk config` | Manage configuration |
| `gk cache` | Manage local cache |
| `gk update` | Update GemKit components |
| `gk versions` | Show available versions |
| `gk doctor` | Diagnose issues |
| `gk extension` | Manage extensions |
| `gk catalog` | Browse available kits |
| `gk convert` | Convert between formats |
| `gk paste-image` | Handle image pasting |

## Quick Start

```bash
# Initialize in your project
gk init

# Spawn an agent
gk agent spawn "Help me write a function"

# View session history
gk session list
```

## Requirements

- Node.js >= 18

## Links

- [Website](https://gemkit.cc)
- [GitHub](https://github.com/therichardngai-code/gemkit-cli)
- [Issues](https://github.com/therichardngai-code/gemkit-cli/issues)

## License

MIT