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
| `gk team` | Multi-agent team coordination |
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

## Agent Commands

### One-Shot Mode (Spawn)

Fire-and-forget agent execution that blocks until completion.

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

### Interactive Mode

Persistent AI session for multi-turn conversations with tool approval control.

| Command | Description |
|---------|-------------|
| `gk agent start` | Start interactive session |
| `gk agent send "<prompt>"` | Send prompt to session |
| `gk agent wait [timeout]` | Wait for completion (default: 120s) |
| `gk agent pending` | Check pending tool confirmations |
| `gk agent exchange` | Get structured JSON output |
| `gk agent read [lines]` | Read raw terminal output |
| `gk agent status` | Check session status |
| `gk agent stop` | Stop session |

**Start Options:**
- `-a, --agent <name>` - Agent profile name
- `-s, --skills <list>` - Comma-separated skills
- `-c, --context <files>` - Context files (@file syntax)
- `-m, --model <model>` - Model override
- `-t, --tools <list>` - Comma-separated tools to allow
- `--cli <provider>` - CLI provider: `gemini` (default) or `claude`

**CLI Providers:**
- `gemini` - Uses Gemini CLI (default). Loads from `.gemini/agents/`
- `claude` - Uses Claude CLI. Loads from `.claude/agents/`
- Models and tools are automatically mapped between providers

## Team Commands

Coordinate multiple AI agents working in parallel on complex tasks.

### Team Management

| Command | Description |
|---------|-------------|
| `gk team create <name>` | Create a new team |
| `gk team list` | List all teams |
| `gk team info [teamId]` | Show team details |
| `gk team kill [teamId]` | Emergency shutdown |
| `gk team cleanup` | Clean up stale resources |
| `gk team ports` | Show port allocations |
| `gk team reset` | Delete all team data |

### Task Management

| Command | Description |
|---------|-------------|
| `gk team task-create "<subject>"` | Create a task |
| `gk team task-claim <taskId>` | Claim a task |
| `gk team task-done <taskId>` | Mark task completed |
| `gk team tasks [teamId]` | List all tasks |

### Agent Spawning

| Command | Description |
|---------|-------------|
| `gk team start --name <agent>` | Spawn agent as team member |
| `gk team start --name <agent> -a <profile>` | Spawn with explicit profile |
| `gk team start --name <agent> --cli claude` | Use Claude CLI |

### Messaging & Inbox

| Command | Description |
|---------|-------------|
| `gk team send <agent> "<message>"` | Send message to member |
| `gk team broadcast "<message>"` | Send to all members |
| `gk team messages` | View central inbox |
| `gk team messages --pending` | View pending items |
| `gk team respond <msgId> --approve` | Approve request |
| `gk team respond --approve-all` | Approve all pending |

### Agent Interaction

| Command | Description |
|---------|-------------|
| `gk team exchange <agent>` | Get structured output |
| `gk team read <agent>` | Read raw output |

## Agent Office Commands

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

### Single Agent (One-Shot)

```bash
# Initialize in your project
gk init

# Spawn an agent with a task
gk agent spawn -p "Help me write a function"

# Spawn with specific agent profile and skills
gk agent spawn -a researcher -s "frontend-design" -p "Build a dashboard"

# Spawn with Claude CLI instead of Gemini
gk agent spawn --cli claude -a researcher -p "Analyze the codebase"

# Search for the best agent for a task
gk agent search "implement user authentication"
```

### Single Agent (Interactive)

```bash
# Start interactive session
gk agent start -a researcher -s research

# Send a prompt
gk agent send "Research JWT best practices"
gk agent wait

# Check for tool approvals
gk agent pending
gk agent send "2"  # Approve for session

# Get structured output
gk agent exchange

# Stop when done
gk agent stop
```

### Multi-Agent Team

```bash
# Create a team
gk team create my-project --desc "Feature implementation"

# Create tasks
gk team task-create "Research API patterns" --desc "Investigate REST vs GraphQL"
gk team task-create "Implement backend" --desc "Build the API"

# Spawn agents
gk team start --name researcher-1 &
gk team start --name developer-1 &

# Wait for initialization, then assign work
gk team send researcher-1 "Claim and complete the research task"
gk team send developer-1 "Wait for research, then implement"

# Monitor and approve
gk team messages --pending
gk team respond --approve-all

# Check progress
gk team tasks
gk team exchange researcher-1

# Cleanup when done
gk team kill
gk team reset
```

### Agent Office Dashboard

```bash
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
