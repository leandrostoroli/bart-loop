# Bart Loop

Automated task execution loop using Claude Code or OpenCode. Each task gets a fresh agent session with full progress context.

## Quick Start

1. **Install bart**:
   ```bash
   bun install -g .
   # OR
   npm install -g .
   ```

2. **Create a plan.md** in your project:
   ```markdown
   # My Project Plan

   ## Setup
   ### Initialize project
   ### Configure TypeScript

   ## Backend
   ### Create API
   ### Add database

   ## Frontend
   ### Build UI
   ### Style components
   ```

3. **Generate tasks and run**:
   ```bash
   bart plan              # Generate tasks.json from plan.md
   bart status            # Show progress
   bart dashboard         # Open TUI dashboard
   ```

## Usage

```bash
bart                    # Run next available task
bart status            # Show task progress
bart dashboard         # Open TUI dashboard (Ctrl+C to quit)
bart watch            # Auto-refresh dashboard
bart plan              # Generate tasks from plan.md
bart run [task-id]    # Run a specific task
bart reset <task-id>  # Reset task to pending
bart init             # Initialize in current directory
```

## Parallel Execution

Run multiple workstreams in separate terminals:

```bash
bart --workstream A  # Terminal 1
bart --workstream B  # Terminal 2
bart --workstream C  # Terminal 3
```

## Creating Tasks from Plan

Bart can automatically generate tasks from a `plan.md` file:

### Plan Format

```markdown
# Project Plan

## Setup
### Initialize project
### Configure TypeScript
### Set up linting

## Features
### Build authentication
### Create user API
### Add dashboard

## Testing
### Write unit tests
### Integration tests

## Deploy
### Docker setup
### CI/CD pipeline
```

Bart will:
1. Parse headings to create tasks
2. Assign workstreams for parallel execution (A→B→C→D)
3. Detect simple dependencies
4. Generate `tasks.json` ready for execution

### Workstream Strategy

- **A** - Foundation (setup, config)
- **B** - Core features  
- **C** - Testing & integration
- **D** - Deployment & polish

## Requirements

- [Bun](https://bun.sh) (recommended) or Node.js 18+
- [OpenCode CLI](https://opencode.ai) - `npm install -g opencode`
- OR [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/overview) - `npm install -g @anthropic-ai/claude-code`

## Install Globally

```bash
# Using bun (recommended)
bun install -g .

# Using npm
npm install -g .

# Or link for development
npm link .
```

Then use from any directory:
```bash
bart status
bart dashboard
bart plan
```

## AI Agent Integration

Use the `SKILL.md` file with Claude, OpenCode, or Gemini to parse plans into tasks. The skill instructs the AI how to:
1. Analyze a plan.md
2. Break it into executable tasks
3. Assign workstreams for parallel execution
4. Handle dependencies
