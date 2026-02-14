<img src="bart-loop.jpg" alt="Bart Loop" align="center" width="600">

# Bart Loop

Autonomous task execution loop using AI agents. Break down your project into tasks and let AI agents execute them in parallel across multiple workstreams.

## Features

- **Parallel Execution** - Run multiple workstreams simultaneously in separate terminals
- **Auto-Retry** - Handles rate limits automatically with smart wait times
- **Live Dashboard** - TUI dashboard shows real-time progress
- **Plan to Tasks** - Generate tasks from a simple `plan.md` file
- **Session Resume** - Interrupted tasks can resume from where they left off
- **Auto-Commit** - Automatically commits completed work to git

## Quick Start

```bash
# 1. Create a plan.md in your project
cat > plan.md << 'EOF'
# My Project

## Setup
### Initialize project
### Configure TypeScript

## Backend
### Create API
### Add database

## Frontend
### Build UI
### Style components
EOF

# 2. Generate tasks from plan
./bart.sh --plan

# 3. Run tasks
./bart.sh
```

## Usage

```bash
./bart.sh                    # Run next available task
./bart.sh --status           # Show progress
./bart.sh --watch            # Live dashboard
./bart.sh --workstream B     # Run specific workstream
./bart.sh --task A1          # Run specific task
./bart.sh --reset A1         # Reset failed task
```

## Parallel Execution

Run multiple workstreams in separate terminals:

```bash
# Terminal 1
./bart.sh --workstream A

# Terminal 2
./bart.sh --workstream B

# Terminal 3
./bart.sh --workstream C
```

## How It Works

1. **Plan** - Create a `plan.md` with your project tasks
2. **Generate** - Bart converts the plan into executable tasks
3. **Execute** - AI agents work through tasks in parallel
4. **Complete** - Tasks are marked complete and auto-committed

### Workstream Strategy

- **A** - Foundation (setup, config, core)
- **B** - Features (business logic)
- **C** - Testing & integration
- **D** - Deployment & polish

## Requirements

- [Bun](https://bun.sh) or Node.js 18+
- [OpenCode CLI](https://opencode.ai) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
- `jq` (`brew install jq`)

## Configuration

All configuration is in-code with sensible defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `PROJECT_ROOT` | `.` | Project directory |
| `TASKS_FILE` | `.bart/tasks.json` | Tasks storage |
| `LOG_DIR` | `.bart/logs` | Execution logs |
| `LOCK_DIR` | `.bart/.locks` | Parallel locks |
| `AGENT_CLI` | `auto` | Use opencode or claude |
| `AGENT_VERBOSE` | `false` | Enable verbose agent output |
| `AUTO_COMMIT` | `true` | Auto-commit completed work |

Override in code before running or set as env var:
```bash
AGENT_VERBOSE=true ./bart.sh --status
```

## Project Structure

```
your-project/
├── plan.md                 # Your project plan
├── .bart/
│   ├── tasks.json          # Generated tasks
│   ├── plan.md            # Copied plan
│   ├── logs/               # Execution logs
│   └── .locks/             # Parallel execution locks
└── bart-loop/
    └── bart.sh             # Bart executable
```

## License

MIT
