# GemKit CLI

A command-line interface for working with Gemini and Claude AI agents, plans, and sessions.

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
| `gk office` | Agent Office visualization dashboard |
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
| `gk paste` | Handle image and video pasting |

### Agent Commands

| Command | Description |
|---------|-------------|
| `gk agent list` | List all available agent profiles |
| `gk agent info <name>` | Show agent profile details |
| `gk agent search "<task>"` | Find best agent+skills for a task |
| `gk agent spawn -p "<prompt>"` | Spawn a sub-agent |

**Spawn Options:**
- `-a, --agent <name>` - Agent profile name
- `-s, --skills <list>` - Comma-separated skills to inject
- `-c, --context <files>` - Context files (@file syntax)
- `-m, --model <model>` - Model override
- `-t, --tools <list>` - Comma-separated tools to auto-approve
- `--cli <provider>` - CLI provider: `gemini` (default) or `claude`
- `--music` - Play elevator music while waiting

**CLI Providers:**
- `gemini` - Uses Gemini CLI (default). Loads from `.gemini/agents/`
- `claude` - Uses Claude CLI. Loads from `.claude/agents/`
- Models and tools are automatically mapped between providers when using fallback

### Agent Office Commands

| Command | Description |
|---------|-------------|
| `gk office start` | Start the web visualization dashboard |
| `gk office status` | Show current office state |
| `gk office watch` | Watch office state changes in real-time |

**Options:**
- `-p, --port <n>` - Web server port (default: 3847)
- `--no-open` - Don't auto-open browser
- `--json` - Output as JSON

## Quick Start

```bash
# Initialize in your project
gk init

# Spawn an agent with a task
gk agent spawn -p "Help me write a function"

# Spawn with specific agent profile and skills
gk agent spawn -a researcher -s "frontend-design" -p "Build a dashboard"

# Spawn with Claude CLI instead of Gemini
gk agent spawn --cli claude -a researcher -p "Analyze the codebase"

# Spawn with auto-approved tools
gk agent spawn -a code-executor -t "Read,Write,Bash" -p "Fix the bug"

# Search for the best agent for a task
gk agent search "implement user authentication"

# Start the Agent Office dashboard
gk office start

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