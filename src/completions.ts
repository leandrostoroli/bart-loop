import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Shell completion script generators for bart CLI.
 */

const MARKER_START = "# bart-loop completions";
const MARKER_END = "# end bart-loop completions";
const COMPLETIONS_DIR = join(process.env.HOME || "", ".bart", "completions");

export function generateZshCompletion(): string {
  return `#compdef bart

_bart() {
  local -a commands
  local -a global_flags

  commands=(
    'status:Show task status'
    'run:Run next available task or a specific task'
    'plan:Generate tasks from plan.md'
    'plans:List all plan executions'
    'dashboard:Launch TUI dashboard'
    'watch:Auto-refresh dashboard'
    'convert:Convert a plan file to bart tasks'
    'requirements:Show requirements coverage report'
    'specialists:List discovered specialists'
    'config:Show or set configuration'
    'stop:Send stop signal to a running bart run'
    'reset:Reset a task to pending'
    'think:Start guided thinking session before planning'
    'install:Install bart skills globally'
    'init:Initialize bart in current project'
    'completions:Generate or install shell completions'
    'help:Show help'
  )

  global_flags=(
    '--plan[Select a plan execution by slug]:plan slug:_bart_plans'
    '--workstream[Filter by workstream]:workstream id:_bart_workstreams'
    '--tasks[Path to tasks.json (escape hatch)]:file:_files'
    '--plan-file[Path to plan file]:file:_files'
    '--agent[Agent to use (claude, opencode)]:agent:(claude opencode)'
    '--auto-continue[Auto-continue to next task]'
    '--no-auto-continue[Ask before continuing to next task]'
    '--help[Show help]'
  )

  _arguments -C \\
    \$global_flags[@] \\
    '1:command:->command' \\
    '*::arg:->args'

  case \$state in
    command)
      _describe -t commands 'bart command' commands
      ;;
    args)
      case \$words[1] in
        run|r)
          _arguments \\
            \$global_flags[@] \\
            '1:task id:_bart_task_ids'
          ;;
        reset)
          _arguments \\
            \$global_flags[@] \\
            '1:task id:_bart_task_ids'
          ;;
        plan|p)
          _arguments \\
            \$global_flags[@] \\
            '--latest[Generate from latest plan]' \\
            '-l[Generate from latest plan]' \\
            '-y[Skip confirmation]' \\
            '--yes[Skip confirmation]'
          ;;
        convert|c)
          _arguments \\
            \$global_flags[@] \\
            '1:plan file:_files'
          ;;
        config)
          _arguments \\
            '--agent[Set default agent]:agent:(claude opencode)' \\
            '--auto-continue[Set auto-continue]' \\
            '--no-auto-continue[Disable auto-continue]' \\
            '--notify-url[Set notification URL]:url:'
          ;;
        completions)
          local -a subcommands
          subcommands=(
            'zsh:Output zsh completion script'
            'bash:Output bash completion script'
            'install:Install completions to shell rc file'
          )
          _describe -t subcommands 'completions subcommand' subcommands
          ;;
        specialists)
          local -a spec_subcommands
          spec_subcommands=(
            'new:Create a new specialist profile (guided)'
          )
          _arguments \\
            \$global_flags[@] \\
            '--history[Show specialist performance from execution history]' \\
            '--board[Show specialist board grouped by effectiveness]' \\
            '1:subcommand:_describe -t spec_subcommands "specialists subcommand" spec_subcommands'
          ;;
        requirements|reqs)
          _arguments \\
            \$global_flags[@] \\
            '--gaps[Show only uncovered/partial requirements]'
          ;;
        status|s)
          _arguments \\
            \$global_flags[@]
          ;;
        think|t)
          _arguments \\
            \$global_flags[@]
          ;;
        dashboard|d|watch|w)
          _arguments \\
            \$global_flags[@]
          ;;
        *)
          _arguments \$global_flags[@]
          ;;
      esac
      ;;
  esac
}

_bart_plans() {
  local -a plans
  local plans_dir=".bart/plans"
  if [[ -d "\$plans_dir" ]]; then
    plans=(\${(f)"\$(ls -dt "\$plans_dir"/*/ 2>/dev/null | xargs -I{} basename {} 2>/dev/null)"})
    if (( \${#plans[@]} > 0 )); then
      _describe -t plans 'plan slug' plans
    fi
  fi
}

_bart_workstreams() {
  local tasks_file plan_slug
  # Check if --plan was specified earlier in the command line
  local -i idx
  for (( idx=1; idx <= \${#words[@]}; idx++ )); do
    if [[ "\${words[idx]}" == "--plan" && -n "\${words[idx+1]}" ]]; then
      plan_slug="\${words[idx+1]}"
      break
    fi
  done

  if [[ -n "\$plan_slug" ]]; then
    tasks_file=".bart/plans/\$plan_slug/tasks.json"
  else
    # Auto-discover: most recently modified tasks.json
    tasks_file="\$(ls -t .bart/plans/*/tasks.json 2>/dev/null | head -1)"
    if [[ -z "\$tasks_file" && -f ".bart/tasks.json" ]]; then
      tasks_file=".bart/tasks.json"
    fi
  fi

  if [[ -f "\$tasks_file" ]]; then
    local -a workstreams
    workstreams=(\${(f)"\$(grep -o '"workstream"[[:space:]]*:[[:space:]]*"[^"]*"' "\$tasks_file" | sed 's/.*"\\([^"]*\\)"$/\\1/' | sort -u)"})
    if (( \${#workstreams[@]} > 0 )); then
      _describe -t workstreams 'workstream' workstreams
    fi
  fi
}

_bart_task_ids() {
  local tasks_file plan_slug
  # Check if --plan was specified
  local -i idx
  for (( idx=1; idx <= \${#words[@]}; idx++ )); do
    if [[ "\${words[idx]}" == "--plan" && -n "\${words[idx+1]}" ]]; then
      plan_slug="\${words[idx+1]}"
      break
    fi
  done

  if [[ -n "\$plan_slug" ]]; then
    tasks_file=".bart/plans/\$plan_slug/tasks.json"
  else
    tasks_file="\$(ls -t .bart/plans/*/tasks.json 2>/dev/null | head -1)"
    if [[ -z "\$tasks_file" && -f ".bart/tasks.json" ]]; then
      tasks_file=".bart/tasks.json"
    fi
  fi

  if [[ -f "\$tasks_file" ]]; then
    local -a task_ids
    task_ids=(\${(f)"\$(grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' "\$tasks_file" | sed 's/.*"\\([^"]*\\)"$/\\1/')"})
    if (( \${#task_ids[@]} > 0 )); then
      _describe -t task_ids 'task id' task_ids
    fi
  fi
}

_bart "\$@"
`;
}

export function generateBashCompletion(): string {
  return `#!/bin/bash

_bart_plans() {
  local plans_dir=".bart/plans"
  if [[ -d "$plans_dir" ]]; then
    ls -dt "$plans_dir"/*/ 2>/dev/null | while read -r d; do
      basename "$d"
    done
  fi
}

_bart_workstreams() {
  local tasks_file=""
  local plan_slug=""

  # Check if --plan was specified
  local i
  for (( i=0; i < \${#COMP_WORDS[@]}; i++ )); do
    if [[ "\${COMP_WORDS[i]}" == "--plan" && -n "\${COMP_WORDS[i+1]}" ]]; then
      plan_slug="\${COMP_WORDS[i+1]}"
      break
    fi
  done

  if [[ -n "$plan_slug" ]]; then
    tasks_file=".bart/plans/$plan_slug/tasks.json"
  else
    tasks_file="$(ls -t .bart/plans/*/tasks.json 2>/dev/null | head -1)"
    if [[ -z "$tasks_file" && -f ".bart/tasks.json" ]]; then
      tasks_file=".bart/tasks.json"
    fi
  fi

  if [[ -f "$tasks_file" ]]; then
    grep -o '"workstream"[[:space:]]*:[[:space:]]*"[^"]*"' "$tasks_file" | sed 's/.*"\\([^"]*\\)"$/\\1/' | sort -u
  fi
}

_bart_task_ids() {
  local tasks_file=""
  local plan_slug=""

  local i
  for (( i=0; i < \${#COMP_WORDS[@]}; i++ )); do
    if [[ "\${COMP_WORDS[i]}" == "--plan" && -n "\${COMP_WORDS[i+1]}" ]]; then
      plan_slug="\${COMP_WORDS[i+1]}"
      break
    fi
  done

  if [[ -n "$plan_slug" ]]; then
    tasks_file=".bart/plans/$plan_slug/tasks.json"
  else
    tasks_file="$(ls -t .bart/plans/*/tasks.json 2>/dev/null | head -1)"
    if [[ -z "$tasks_file" && -f ".bart/tasks.json" ]]; then
      tasks_file=".bart/tasks.json"
    fi
  fi

  if [[ -f "$tasks_file" ]]; then
    grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' "$tasks_file" | sed 's/.*"\\([^"]*\\)"$/\\1/'
  fi
}

_bart() {
  local cur prev words cword
  _init_completion || return

  local commands="status run plan plans think dashboard watch convert requirements specialists config stop reset install init completions help"
  local global_flags="--plan --workstream --tasks --plan-file --agent --auto-continue --no-auto-continue --help"

  # Find the subcommand
  local cmd=""
  local i
  for (( i=1; i < cword; i++ )); do
    case "\${words[i]}" in
      --plan|--workstream|--tasks|--plan-file|--agent)
        (( i++ ))
        ;;
      -*)
        ;;
      *)
        cmd="\${words[i]}"
        break
        ;;
    esac
  done

  # Complete global flag values
  case "$prev" in
    --plan)
      COMPREPLY=( $(compgen -W "$(_bart_plans)" -- "$cur") )
      return
      ;;
    --workstream)
      COMPREPLY=( $(compgen -W "$(_bart_workstreams)" -- "$cur") )
      return
      ;;
    --tasks|--plan-file)
      _filedir
      return
      ;;
    --agent)
      COMPREPLY=( $(compgen -W "claude opencode" -- "$cur") )
      return
      ;;
  esac

  # No subcommand yet — complete commands and global flags
  if [[ -z "$cmd" ]]; then
    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
    else
      COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    fi
    return
  fi

  # Subcommand-specific completions
  case "$cmd" in
    run|r|reset)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "$(_bart_task_ids)" -- "$cur") )
      fi
      ;;
    plan|p)
      COMPREPLY=( $(compgen -W "$global_flags --latest -l -y --yes" -- "$cur") )
      ;;
    convert|c)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      else
        _filedir
      fi
      ;;
    config)
      COMPREPLY=( $(compgen -W "--agent --auto-continue --no-auto-continue --notify-url" -- "$cur") )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "zsh bash install" -- "$cur") )
      ;;
    specialists)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "$global_flags --history --board" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "new" -- "$cur") )
      fi
      ;;
    requirements|reqs)
      COMPREPLY=( $(compgen -W "$global_flags --gaps" -- "$cur") )
      ;;
    think|t)
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      ;;
    status|s|dashboard|d|watch|w)
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
      ;;
  esac
}

complete -F _bart bart
`;
}

export async function installCompletions(shell: string): Promise<void> {
  const home = process.env.HOME || "";
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }

  mkdirSync(COMPLETIONS_DIR, { recursive: true });

  if (shell === "zsh") {
    await installZshCompletions(home);
  } else if (shell === "bash") {
    await installBashCompletions(home);
  } else {
    throw new Error(`Unsupported shell: ${shell}. Supported: zsh, bash`);
  }
}

async function installZshCompletions(home: string): Promise<void> {
  const completionFile = join(COMPLETIONS_DIR, "_bart");
  const rcFile = join(home, ".zshrc");

  const script = generateZshCompletion();
  writeFileSync(completionFile, script);
  console.log(`  Wrote completion script to ${completionFile}`);

  let rcContent = "";
  if (existsSync(rcFile)) {
    rcContent = readFileSync(rcFile, "utf-8");
  }

  // Idempotency: replace existing block if present
  if (rcContent.includes(MARKER_START)) {
    const startIdx = rcContent.indexOf(MARKER_START);
    const endIdx = rcContent.indexOf(MARKER_END);
    if (endIdx !== -1) {
      const before = rcContent.slice(0, startIdx);
      const after = rcContent.slice(endIdx + MARKER_END.length + 1);
      rcContent = before + buildZshRcBlock() + after;
      writeFileSync(rcFile, rcContent);
      console.log(`  Updated existing bart-loop completions block in ${rcFile}`);
      return;
    }
  }

  const newBlock = "\n" + buildZshRcBlock();
  writeFileSync(rcFile, rcContent + newBlock);
  console.log(`  Added completion setup to ${rcFile}`);
}

function buildZshRcBlock(): string {
  const lines: string[] = [
    MARKER_START,
    `fpath=(~/.bart/completions $fpath)`,
    `if ! type compdef &>/dev/null; then`,
    `  autoload -Uz compinit && compinit`,
    `fi`,
    MARKER_END,
  ];
  return lines.join("\n") + "\n";
}

async function installBashCompletions(home: string): Promise<void> {
  const completionFile = join(COMPLETIONS_DIR, "bart.bash");
  const rcFile = join(home, ".bashrc");

  const script = generateBashCompletion();
  writeFileSync(completionFile, script);
  console.log(`  Wrote completion script to ${completionFile}`);

  let rcContent = "";
  if (existsSync(rcFile)) {
    rcContent = readFileSync(rcFile, "utf-8");
  }

  // Idempotency: replace existing block if present
  if (rcContent.includes(MARKER_START)) {
    const startIdx = rcContent.indexOf(MARKER_START);
    const endIdx = rcContent.indexOf(MARKER_END);
    if (endIdx !== -1) {
      const before = rcContent.slice(0, startIdx);
      const after = rcContent.slice(endIdx + MARKER_END.length + 1);
      rcContent = before + buildBashRcBlock() + after;
      writeFileSync(rcFile, rcContent);
      console.log(`  Updated existing bart-loop completions block in ${rcFile}`);
      return;
    }
  }

  const newBlock = "\n" + buildBashRcBlock();
  writeFileSync(rcFile, rcContent + newBlock);
  console.log(`  Added completion setup to ${rcFile}`);
}

function buildBashRcBlock(): string {
  return [
    MARKER_START,
    `source ~/.bart/completions/bart.bash`,
    MARKER_END,
  ].join("\n") + "\n";
}
