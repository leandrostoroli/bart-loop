<img src="bart-loop.png" alt="Bart Loop" align="center" width="800">

# Bart Loop

**Autonomous task execution loop using AI agents. Break down your project into tasks and let Claude Code or OpenCode execute them — in parallel, across multiple workstreams.**

[![npm version](https://img.shields.io/npm/v/bart-loop?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/bart-loop)
[![GitHub stars](https://img.shields.io/github/stars/leandrostoroli/bart-loop?style=for-the-badge&logo=github&color=181717)](https://github.com/leandrostoroli/bart-loop)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

<br>

*"Stop manually running Claude for every task. Let bart loop through your entire project plan."*

---

## Why Bart?

You're using Claude Code or OpenCode to build. That's great — but running commands manually for each task is slow.

Bart fixes that. It's the automation layer that:

- **Runs your entire project** — One command starts executing all tasks
- **Handles dependencies** — Waits for cross-workstream deps, notifies when blocked
- **Works in parallel** — Run multiple workstreams in separate terminals
- **Keeps you informed** — Notifications when workstreams complete or get stuck

No more:
- Starting Claude for every single task
- Checking which task comes next
- Wondering if something is waiting on another workstream
- Manually tracking progress

---

## Install

```bash
npm install -g bart-loop
# or
bun install -g bart-loop
```

Requires: [Bun](https://bun.sh) or Node.js 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) or [OpenCode](https://opencode.ai).

---

## Quick Start

```bash
# 1. Create a plan.md
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

# 2. Generate tasks
bart plan

# 3. Run everything
bart run
```

Or use your latest Claude plan directly:
```bash
bart plan --latest
```

---

## How It Works

### 1. Plan

Create a `plan.md` with your project tasks, or use Claude's plan mode to generate one. Bart converts it into executable tasks.

### 2. Execute

```bash
bart run
```

Bart:
- Finds the next available task
- Runs Claude Code with `--dangerously-skip-permissions`
- Marks tasks complete automatically
- Continues to the next task

### 3. Parallelize

Run multiple workstreams in separate terminals:

```bash
# Terminal 1
bart run --workstream A

# Terminal 2  
bart run --workstream B
```

---

## Commands

| Command | What it does |
|---------|--------------|
| `bart` | Run next available task |
| `bart run` | Run all available tasks (auto-continue) |
| `bart run --no-auto-continue` | Ask after each task |
| `bart run A1` | Run specific task |
| `bart run --workstream B` | Run tasks in workstream B only |
| `bart status` | Show progress |
| `bart status --workstream A` | Detailed status for workstream A |
| `bart dashboard` | TUI dashboard |
| `bart watch` | Auto-refresh dashboard |
| `bart plan` | Generate tasks from plan.md |
| `bart plan --latest` | Generate from latest Claude plan |
| `bart plan --latest -y` | Skip confirmation prompt |
| `bart reset A1` | Reset task A1 to pending |
| `bart config` | Show configuration |

---

## Configuration

```bash
# Show current config
bart config

# Agent selection
bart config --agent claude    # Claude Code (default)
bart config --agent opencode   # OpenCode

# Auto-continue mode
bart config --auto-continue   # Run all tasks automatically (default)
bart config --no-auto-continue  # Ask after each task

# Notifications
bart config --notify-url "https://api.day.app/YOUR_KEY/"
```

### Notifications

Get notified when workstreams complete or get blocked:

**iOS via Bark (Recommended)**
1. Install [Bark](https://apps.apple.com/app/bark/) on iPhone (free)
2. Get your key from the app
3. Configure: `bart config --notify-url "https://api.day.app/YOUR_KEY/"`

**Mac Notifications**
Native macOS notifications work automatically. Enable "Sync to this iPhone" in Notification settings to receive on iOS.

---

## Workstreams

Bart organizes tasks into workstreams (A, B, C, D, E, F) for parallel execution:

| Workstream | Purpose |
|------------|---------|
| A | Foundation (setup, config, core) |
| B | Features (business logic) |
| C | Testing & integration |
| D | Deployment & polish |
| E, F | Additional parallel tracks |

### Dependencies

Tasks can depend on other tasks:

```json
{
  "id": "B2",
  "depends_on": ["A1", "A2"]
}
```

Bart waits automatically and notifies when blocked.

---

## Project Structure

```
your-project/
├── plan.md                 # Your project plan
└── .bart/
    ├── tasks.json          # Generated tasks
    ├── plan.md            # Copied plan
    └── logs/              # Execution logs
```

---

## Recommended: Skip Permissions

Bart is designed for frictionless automation. Run with:

```bash
claude --dangerously-skip-permissions
```

Or set in config:
```bash
bart config --agent claude
```

---

## Troubleshooting

**Tasks not running?**
- Check `bart status` for progress
- Use `bart reset <task-id>` to restart a stuck task

**Workstream blocked?**
- Run without `--workstream` flag to process all workstreams
- Or run workstreams in order: A → B → C

**Need to stop?**
- Ctrl+C stops the current task
- Resume anytime with `bart run` — it picks up where you left off

---

## License

MIT — See [LICENSE](LICENSE) for details.

---

<div align="center">

**Let AI do the work. You focus on shipping.**

</div>
