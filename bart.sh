#!/usr/bin/env bash
set -euo pipefail

# Bart Loop — Automated task execution via Claude Code or OpenCode
# Each task gets a fresh agent session with full progress context.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default configuration values (all in code, project-relative paths use .bart/)
PROJECT_ROOT="${PROJECT_ROOT:-$PWD}"
TASKS_FILE="${TASKS_FILE:-$PROJECT_ROOT/.bart/tasks.json}"
PROMPT_TEMPLATE="${PROMPT_TEMPLATE:-$SCRIPT_DIR/bart-prompt-template.md}"
PLAN_FILE="${PLAN_FILE:-}"
LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/.bart/logs}"
LOCK_DIR="${LOCK_DIR:-$PROJECT_ROOT/.bart/.locks}"
AGENT_CLI="${AGENT_CLI:-auto}"
AGENT_VERBOSE="${AGENT_VERBOSE:-false}"
AGENT_ARGS="${AGENT_ARGS:---print --output-format stream-json}"
AUTO_COMMIT="${AUTO_COMMIT:-true}"
LOOP_NAME="${LOOP_NAME:-Bart Loop}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Detect available CLI
detect_agent_cli() {
    local cli=""
    if [ "$AGENT_CLI" = "auto" ]; then
        if command -v opencode &> /dev/null; then
            cli="opencode"
        elif command -v claude &> /dev/null; then
            cli="claude"
        fi
    elif [ "$AGENT_CLI" = "opencode" ]; then
        cli="opencode"
    elif [ "$AGENT_CLI" = "claude" ]; then
        cli="claude"
    fi
    echo "$cli"
}

AGENT_CMD=$(detect_agent_cli)

# Ensure jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required. Install with: brew install jq${NC}"
    exit 1
fi

# Ensure agent CLI is available
if [ -z "$AGENT_CMD" ]; then
    echo -e "${RED}Error: opencode or claude CLI is required.${NC}"
    echo -e "  Install opencode: npm install -g opencode"
    echo -e "  Or install claude: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Get default args for the specific CLI
get_agent_args() {
    local verbose_flag=""
    if [ "$AGENT_VERBOSE" = "true" ]; then
        verbose_flag="--verbose"
    fi
    
    if [ "$AGENT_CMD" = "opencode" ]; then
        echo "${verbose_flag} ${AGENT_ARGS}"
    else
        echo "--dangerously-skip-permissions ${verbose_flag} ${AGENT_ARGS}"
    fi
}

mkdir -p "$LOG_DIR" "$LOCK_DIR"

# ─── Stream Parser ───────────────────────────────────────────────────────────

parse_agent_stream() {
    local log_file="$1"
    local session_announced=false
    while IFS= read -r line; do
        echo "$line" >> "$log_file"

        local etype
        etype=$(printf '%s' "$line" | jq -r '.type // empty' 2>/dev/null) || continue

        case "$etype" in
            system)
                if [ "$session_announced" = false ]; then
                    echo -e "  ${BLUE}● ${AGENT_CMD^} session started${NC}"
                    session_announced=true
                fi
                ;;
            assistant)
                printf '%s' "$line" | jq -r '
                    .message.content[]? |
                    if .type == "tool_use" then
                        "  \u001b[36m→ \(.name)\u001b[0m" +
                        (if .name == "Write" or .name == "Read" or .name == "Edit" then
                            " \u001b[33m\(.input.file_path // "")\u001b[0m"
                        elif .name == "Bash" then
                            " \u001b[33m" + (.input.command // "" | if length > 80 then .[0:80] + "…" else . end) + "\u001b[0m"
                        elif .name == "Glob" then
                            " \u001b[33m\(.input.pattern // "")\u001b[0m"
                        elif .name == "Grep" then
                            " \u001b[33m\(.input.pattern // "")\u001b[0m"
                        else "" end)
                    elif .type == "text" then
                        .text
                    else empty end
                ' 2>/dev/null
                ;;
            result)
                local subtype num_turns cost
                subtype=$(printf '%s' "$line" | jq -r '.subtype // "unknown"' 2>/dev/null)
                num_turns=$(printf '%s' "$line" | jq -r '.num_turns // 0' 2>/dev/null)
                cost=$(printf '%s' "$line" | jq -r '.cost_usd // 0' 2>/dev/null)
                local sid
                sid=$(printf '%s' "$line" | jq -r '.session_id // empty' 2>/dev/null)
                if [ -n "$sid" ]; then
                    echo "$sid" > "${log_file}.sid"
                fi

                local result_text
                result_text=$(printf '%s' "$line" | jq -r '.result // ""' 2>/dev/null)
                if echo "$result_text" | grep -qiE "hit your limit|rate limit|usage cap|rate_limit|too many requests|quota exceeded|insufficient credits"; then
                    echo "$result_text" > "${log_file}.ratelimit"
                fi

                if [ "$subtype" = "success" ] && [ ! -f "${log_file}.ratelimit" ]; then
                    echo -e "\n  ${GREEN}● Done (${num_turns} turns, \$${cost})${NC}"
                elif [ -f "${log_file}.ratelimit" ]; then
                    echo -e "\n  ${YELLOW}● Rate limited: ${result_text}${NC}"
                else
                    local errmsg
                    errmsg=$(printf '%s' "$line" | jq -r '.result // "unknown error"' 2>/dev/null)
                    echo -e "\n  ${RED}● Failed: ${errmsg}${NC}"
                fi
                ;;
        esac
    done
}

compute_rate_limit_wait() {
    local msg="$1"
    
    # Try to extract retry-after header value
    local retry_after
    retry_after=$(echo "$msg" | grep -oiE 'retry[-_]after[:\s]+[0-9]+' | grep -oE '[0-9]+' | head -1)
    if [ -n "$retry_after" ] && [ "$retry_after" -gt 0 ]; then
        echo $((retry_after + 60))  # Add buffer
        return
    fi
    
    # Try to extract seconds from message (e.g., "try again in 60 seconds")
    local seconds
    seconds=$(echo "$msg" | grep -oiE 'in [0-9]+ seconds?' | grep -oE '[0-9]+' | head -1)
    if [ -n "$seconds" ] && [ "$seconds" -gt 0 ]; then
        echo $((seconds + 30))
        return
    fi
    
    # Try to extract minutes from message
    local minutes
    minutes=$(echo "$msg" | grep -oiE 'in [0-9]+ minutes?' | grep -oE '[0-9]+' | head -1)
    if [ -n "$minutes" ] && [ "$minutes" -gt 0 ]; then
        echo $((minutes * 60 + 60))
        return
    fi
    
    # Try to extract time with timezone
    local tz
    tz=$(echo "$msg" | grep -oE '\([A-Za-z_/]+\)' | tr -d '()' | head -1)
    tz=${tz:-UTC}
    local reset_time
    reset_time=$(echo "$msg" | grep -oiE '[0-9]{1,2}(:[0-9]{2})?\s*(am|pm)' | head -1)

    if [ -n "$reset_time" ]; then
        local hour minute period
        hour=$(echo "$reset_time" | grep -oE '^[0-9]{1,2}')
        minute=$(echo "$reset_time" | grep -oE ':[0-9]{2}' | tr -d ':')
        minute=${minute:-0}
        period=$(echo "$reset_time" | grep -oiE '(am|pm)')

        if [ "${period,,}" = "am" ]; then
            [ "$hour" -eq 12 ] && hour=0
        else
            [ "$hour" -ne 12 ] && hour=$((hour + 12))
        fi

        local reset_secs=$(( hour * 3600 + minute * 60 ))
        local cur_h cur_m cur_s
        cur_h=$(TZ="$tz" date +%H | sed 's/^0//')
        cur_m=$(TZ="$tz" date +%M | sed 's/^0//')
        cur_s=$(TZ="$tz" date +%S | sed 's/^0//')
        local now_secs=$(( cur_h * 3600 + cur_m * 60 + cur_s ))
        local wait=$((reset_secs - now_secs))
        if [ "$wait" -le 0 ]; then
            wait=$((wait + 86400))
        fi
        echo $((wait + 120))
    else
        echo 3600  # Default: 1 hour
    fi
}

# ─── Helper Functions ────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Automated task loop. Launches ${AGENT_CMD:-agent} sessions for each task.

OPTIONS:
    --workstream <ID>   Run only tasks in workstream (A-Z). Use in parallel terminals.
    --task <ID>         Run a specific task (e.g., B3).
    --status            Show current progress (one-shot).
    --watch [SECS]      Live dashboard, refreshes every SECS seconds (default 5).
    --reset <ID>        Reset a task to pending (for retry).
    --reset-errors      Reset all errored tasks to pending.
    --dry-run           Show what would run next without executing.
    --help              Show this help.

EXAMPLES:
    ./bart.sh                          # Run next available task
    ./bart.sh --workstream B           # Run workstream B tasks
    ./bart.sh --status                 # Show progress
    ./bart.sh --watch                  # Live dashboard
    ./bart.sh --watch 2                # Live dashboard, 2s refresh
    ./bart.sh --reset B3               # Reset task B3 for retry

PARALLEL EXECUTION (in separate terminals):
    ./bart.sh --workstream B           # Terminal 1
    ./bart.sh --workstream C           # Terminal 2
    ./bart.sh --workstream D           # Terminal 3
EOF
}

get_task_field() {
    local task_id="$1"
    local field="$2"
    jq -r ".tasks[] | select(.id == \"$task_id\") | .$field" "$TASKS_FILE"
}

get_all_task_ids() {
    jq -r '.tasks[].id' "$TASKS_FILE"
}

deps_met() {
    local task_id="$1"
    local deps
    deps=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .depends_on[]?" "$TASKS_FILE")

    if [ -z "$deps" ]; then
        return 0
    fi

    while IFS= read -r dep; do
        local dep_status
        dep_status=$(get_task_field "$dep" "status")
        if [ "$dep_status" != "completed" ]; then
            return 1
        fi
    done <<< "$deps"

    return 0
}

is_locked() {
    local task_id="$1"
    local lock_file="$LOCK_DIR/$task_id.lock"
    if [ -f "$lock_file" ]; then
        local lock_pid
        lock_pid=$(cat "$lock_file")
        if kill -0 "$lock_pid" 2>/dev/null; then
            return 0
        else
            rm -f "$lock_file"
            return 1
        fi
    fi
    return 1
}

lock_task() {
    local task_id="$1"
    echo $$ > "$LOCK_DIR/$task_id.lock"
}

unlock_task() {
    local task_id="$1"
    rm -f "$LOCK_DIR/$task_id.lock"
}

find_next_task() {
    local workstream_filter="${1:-}"
    local query
    if [ -n "$workstream_filter" ]; then
        query=".tasks[] | select(.workstream == \"$workstream_filter\" and .status == \"pending\") | .id"
    else
        query='.tasks[] | select(.status == "pending") | .id'
    fi

    local pending_tasks
    pending_tasks=$(jq -r "$query" "$TASKS_FILE")

    if [ -z "$pending_tasks" ]; then
        return 1
    fi

    while IFS= read -r task_id; do
        if deps_met "$task_id" && ! is_locked "$task_id"; then
            echo "$task_id"
            return 0
        fi
    done <<< "$pending_tasks"

    return 1
}

update_task() {
    local task_id="$1"
    local field="$2"
    local value="$3"
    local tmp_file
    tmp_file=$(mktemp)

    if [ "$field" = "status" ] || [ "$field" = "error" ] || [ "$field" = "started_at" ] || [ "$field" = "completed_at" ]; then
        jq "(.tasks[] | select(.id == \"$task_id\") | .$field) = \"$value\"" "$TASKS_FILE" > "$tmp_file"
    elif [ "$field" = "files_modified" ]; then
        jq "(.tasks[] | select(.id == \"$task_id\") | .$field) = $value" "$TASKS_FILE" > "$tmp_file"
    else
        jq "(.tasks[] | select(.id == \"$task_id\") | .$field) = \"$value\"" "$TASKS_FILE" > "$tmp_file"
    fi

    mv "$tmp_file" "$TASKS_FILE"
}

build_prompt() {
    local task_id="$1"
    local title description files depends_on
    title=$(get_task_field "$task_id" "title")
    description=$(get_task_field "$task_id" "description")
    files=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .files | join(\", \")" "$TASKS_FILE")
    depends_on=$(jq -r ".tasks[] | select(.id == \"$task_id\") | .depends_on | join(\", \")" "$TASKS_FILE")

    local completed_summary
    completed_summary=$(jq -r '
        .tasks[]
        | select(.status == "completed")
        | "- \(.id): \(.title) — Files: \(.files_modified | join(", "))"
    ' "$TASKS_FILE")

    if [ -z "$completed_summary" ]; then
        completed_summary="(none yet — this is the first task)"
    fi

    local all_files_modified
    all_files_modified=$(jq -r '
        [.tasks[] | select(.status == "completed") | .files_modified[]] | unique | join("\n")
    ' "$TASKS_FILE")

    if [ -z "$all_files_modified" ]; then
        all_files_modified="(none yet)"
    fi

    local dep_details=""
    if [ -n "$depends_on" ] && [ "$depends_on" != "" ]; then
        dep_details=$(echo "$depends_on" | tr ',' '\n' | while read -r dep; do
            dep=$(echo "$dep" | xargs)
            local dep_title
            dep_title=$(get_task_field "$dep" "title")
            echo "- $dep: $dep_title (completed)"
        done)
    else
        dep_details="(none — this task has no dependencies)"
    fi

    local prompt
    prompt=$(cat "$PROMPT_TEMPLATE")
    prompt="${prompt//\{\{COMPLETED_TASKS\}\}/$completed_summary}"
    prompt="${prompt//\{\{FILES_MODIFIED\}\}/$all_files_modified}"
    prompt="${prompt//\{\{TASK_ID\}\}/$task_id}"
    prompt="${prompt//\{\{TASK_TITLE\}\}/$title}"
    prompt="${prompt//\{\{TASK_DESCRIPTION\}\}/$description}"
    prompt="${prompt//\{\{TASK_FILES\}\}/$files}"
    prompt="${prompt//\{\{TASK_DEPENDENCIES\}\}/$dep_details}"
    prompt="${prompt//\{\{PROJECT_ROOT\}\}/$PROJECT_ROOT}"
    prompt="${prompt//\{\{PLAN_FILE\}\}/$PLAN_FILE}"

    echo "$prompt"
}

show_status() {
    local total pending in_progress completed errored
    total=$(jq '.tasks | length' "$TASKS_FILE")
    pending=$(jq '[.tasks[] | select(.status == "pending")] | length' "$TASKS_FILE")
    in_progress=$(jq '[.tasks[] | select(.status == "in_progress")] | length' "$TASKS_FILE")
    completed=$(jq '[.tasks[] | select(.status == "completed")] | length' "$TASKS_FILE")
    errored=$(jq '[.tasks[] | select(.status == "error")] | length' "$TASKS_FILE")

    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}        ${BLUE}${LOOP_NAME} Status${NC}           ${CYAN}║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
    printf "${CYAN}║${NC}  Total:       %-30s${CYAN}║${NC}\n" "$total"
    printf "${CYAN}║${NC}  ${GREEN}Completed:${NC}   %-30s${CYAN}║${NC}\n" "$completed"
    printf "${CYAN}║${NC}  ${YELLOW}In Progress:${NC} %-30s${CYAN}║${NC}\n" "$in_progress"
    printf "${CYAN}║${NC}  Pending:     %-30s${CYAN}║${NC}\n" "$pending"
    printf "${CYAN}║${NC}  ${RED}Errors:${NC}      %-30s${CYAN}║${NC}\n" "$errored"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

    echo ""
    echo -e "${BLUE}Workstream Progress:${NC}"

    local workstreams
    workstreams=$(jq -r '[.tasks[].workstream] | unique | .[]' "$TASKS_FILE")

    for ws in $workstreams; do
        local ws_total ws_done
        ws_total=$(jq "[.tasks[] | select(.workstream == \"$ws\")] | length" "$TASKS_FILE" 2>/dev/null)
        ws_total=${ws_total:-0}
        ws_done=$(jq "[.tasks[] | select(.workstream == \"$ws\" and .status == \"completed\")] | length" "$TASKS_FILE" 2>/dev/null)
        ws_done=${ws_done:-0}

        local pct=0
        if [ "$ws_total" -gt 0 ]; then
            pct=$(( ws_done * 100 / ws_total ))
        fi
        local bar_len=20
        local filled=$(( pct * bar_len / 100 ))
        local empty=$(( bar_len - filled ))
        local bar=""
        for ((i=0; i<filled; i++)); do bar+="█"; done
        for ((i=0; i<empty; i++)); do bar+="░"; done

        if [ "$ws_done" -eq "$ws_total" ] && [ "$ws_total" -gt 0 ]; then
            printf "  ${GREEN}%s [%s] %d/%d ✓${NC}\n" "$ws" "$bar" "$ws_done" "$ws_total"
        else
            printf "  %s [%s] %d/%d\n" "$ws" "$bar" "$ws_done" "$ws_total"
        fi
    done

    echo ""

    if [ "$errored" -gt 0 ]; then
        echo -e "${RED}Errored Tasks:${NC}"
        jq -r '.tasks[] | select(.status == "error") | "  \(.id): \(.title) — \(.error)"' "$TASKS_FILE"
        echo ""
    fi

    echo -e "${BLUE}Available Next:${NC}"
    local found_any=false
    local workstreams_all
    workstreams_all=$(jq -r '[.tasks[].workstream] | unique | .[]' "$TASKS_FILE")
    for ws in $workstreams_all; do
        local next
        next=$(find_next_task "$ws" 2>/dev/null || true)
        if [ -n "$next" ]; then
            local next_title
            next_title=$(get_task_field "$next" "title")
            echo -e "  ${ws}: ${YELLOW}${next}${NC} — $next_title"
            found_any=true
        fi
    done
    if [ "$found_any" = false ]; then
        if [ "$completed" -eq "$total" ]; then
            echo -e "  ${GREEN}All tasks completed!${NC}"
        else
            echo "  (no tasks available — waiting on dependencies or all in progress)"
        fi
    fi
}

watch_status() {
    local interval="${1:-5}"
    trap 'tput cnorm; exit 0' INT TERM
    tput civis

    while true; do
        tput clear
        
        local timestamp
        timestamp=$(date '+%H:%M:%S')
        
        echo -e "${CYAN}┌${NC}$(printf '─' 78)${CYAN}┐${NC}"
        printf "${CYAN}│${NC}  🦊 ${BLUE}%s${NC} — Live ${CYAN}│${NC}\n" "$LOOP_NAME"
        printf "${CYAN}│${NC}  %s  (every %ds, Ctrl-C to quit)                    ${CYAN}│${NC}\n" "$timestamp" "$interval"
        echo -e "${CYAN}└${NC}$(printf '─' 78)${CYAN}┘${NC}"
        
        local workstreams
        workstreams=$(jq -r '[.tasks[].workstream] | unique | .[]' "$TASKS_FILE")
        local ws_count
        ws_count=$(echo "$workstreams" | wc -w | tr -d ' ')
        
        if [ "$ws_count" -eq 0 ]; then
            echo -e "${YELLOW}No workstreams found in tasks.json${NC}"
            sleep "$interval"
            continue
        fi
        
        local col_width=38
        local cols=2
        local row=0
        
        echo ""
        
        for ws in $workstreams; do
            if [ $((row % cols)) -eq 0 ]; then
                [ $row -gt 0 ] && echo ""
                echo -e "${CYAN}┌${NC}$(printf '─' $col_width)${CYAN}┐${NC} ${CYAN}┌${NC}$(printf '─' $col_width)${CYAN}┐${NC}"
            else
                echo -e " ${CYAN}┌${NC}$(printf '─' $col_width)${CYAN}┐${NC}"
            fi
            
            printf "${CYAN}│${NC} ${BLUE}Workstream %s${NC}%-28s${CYAN}│${NC}" "$ws" ""
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC} ${BLUE}Workstream %s${NC}%-28s${CYAN}│${NC}" "$ws" ""
            echo ""
            
            local ws_total ws_done ws_in_progress ws_error
            ws_total=$(jq "[.tasks[] | select(.workstream == \"$ws\")] | length" "$TASKS_FILE" 2>/dev/null)
            ws_total=${ws_total:-0}
            ws_done=$(jq "[.tasks[] | select(.workstream == \"$ws\" and .status == \"completed\")] | length" "$TASKS_FILE" 2>/dev/null)
            ws_done=${ws_done:-0}
            ws_in_progress=$(jq "[.tasks[] | select(.workstream == \"$ws\" and .status == \"in_progress\")] | length" "$TASKS_FILE" 2>/dev/null)
            ws_in_progress=${ws_in_progress:-0}
            ws_error=$(jq "[.tasks[] | select(.workstream == \"$ws\" and .status == \"error\")] | length" "$TASKS_FILE" 2>/dev/null)
            ws_error=${ws_error:-0}
            
            local pct=0
            if [ "$ws_total" -gt 0 ]; then
                pct=$(( ws_done * 100 / ws_total ))
            fi
            local bar_len=16
            local filled=$(( pct * bar_len / 100 ))
            local empty=$(( bar_len - filled ))
            local bar=""
            for ((i=0; i<filled; i++)); do bar+="█"; done
            for ((i=0; i<empty; i++)); do bar+="░"; done
            
            printf "${CYAN}│${NC}  [%s] %d%%  (%d/%d)    ${CYAN}│${NC}" "$bar" "$pct" "$ws_done" "$ws_total"
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}  [%s] %d%%  (%d/%d)    ${CYAN}│${NC}" "$bar" "$pct" "$ws_done" "$ws_total"
            echo ""
            echo -e "${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}" && [ $((row % cols)) -eq 0 ] && echo " ${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}"
            
            printf "${CYAN}│${NC}  ${GREEN}✓ Completed${NC}%-28s${CYAN}│${NC}" ""
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}  ${GREEN}✓ Completed${NC}%-28s${CYAN}│${NC}" ""
            echo ""
            
            local completed_tasks
            completed_tasks=$(jq -r ".tasks[] | select(.workstream == \"$ws\" and .status == \"completed\") | .id" "$TASKS_FILE" 2>/dev/null)
            if [ -n "$completed_tasks" ]; then
                local shown=0
                while IFS= read -r tid; do
                    [ $shown -ge 4 ] && break
                    local ttitle
                    ttitle=$(get_task_field "$tid" "title")
                    if [ ${#ttitle} -gt 24 ]; then
                        ttitle="${ttitle:0:21}..."
                    fi
                    printf "${CYAN}│${NC}    ${GREEN}%s${NC}: %-22s${CYAN}│${NC}" "$tid" "$ttitle"
                    [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    ${GREEN}%s${NC}: %-22s${CYAN}│${NC}" "$tid" "$ttitle"
                    echo ""
                    shown=$((shown + 1))
                done <<< "$completed_tasks"
                if [ $((shown)) -lt 4 ]; then
                    local more_done
                    more_done=$(jq "[.tasks[] | select(.workstream == \"$ws\" and .status == \"completed\")] | length - $shown" "$TASKS_FILE" 2>/dev/null)
                    if [ "$more_done" -gt 0 ]; then
                        printf "${CYAN}│${NC}    ... and %d more             ${CYAN}│${NC}" "$more_done"
                        [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    ... and %d more             ${CYAN}│${NC}" "$more_done"
                        echo ""
                    fi
                fi
            else
                printf "${CYAN}│${NC}    (none)                       ${CYAN}│${NC}" ""
                [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    (none)                       ${CYAN}│${NC}" ""
                echo ""
            fi
            
            echo -e "${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}" && [ $((row % cols)) -eq 0 ] && echo " ${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}"
            
            printf "${CYAN}│${NC}  ${YELLOW}◐ In Progress${NC}%-25s${CYAN}│${NC}" ""
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}  ${YELLOW}◐ In Progress${NC}%-25s${CYAN}│${NC}" ""
            echo ""
            
            local in_progress_task
            in_progress_task=$(jq -r ".tasks[] | select(.workstream == \"$ws\" and .status == \"in_progress\") | .id" "$TASKS_FILE" 2>/dev/null | head -1)
            if [ -n "$in_progress_task" ]; then
                local ititle istart ielapsed
                ititle=$(get_task_field "$in_progress_task" "title")
                istart=$(get_task_field "$in_progress_task" "started_at")
                if [ -n "$istart" ] && [ "$istart" != "null" ]; then
                    local start_epoch now_epoch
                    start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$istart" "+%s" 2>/dev/null || echo 0)
                    now_epoch=$(date "+%s")
                    ielapsed=$(( (now_epoch - start_epoch) / 60 ))
                fi
                if [ ${#ititle} -gt 22 ]; then
                    ititle="${ititle:0:19}..."
                fi
                printf "${CYAN}│${NC}    ${YELLOW}%s${NC}: %-20s${CYAN}│${NC}" "$in_progress_task" "$ititle"
                [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    ${YELLOW}%s${NC}: %-20s${CYAN}│${NC}" "$in_progress_task" "$ititle"
                echo ""
                if [ -n "$ielapsed" ]; then
                    printf "${CYAN}│${NC}    elapsed: %dm                    ${CYAN}│${NC}" "$ielapsed"
                    [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    elapsed: %dm                    ${CYAN}│${NC}" "$ielapsed"
                    echo ""
                fi
            else
                printf "${CYAN}│${NC}    (none)                       ${CYAN}│${NC}" ""
                [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    (none)                       ${CYAN}│${NC}" ""
                echo ""
            fi
            
            echo -e "${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}" && [ $((row % cols)) -eq 0 ] && echo " ${CYAN}├${NC}$(printf '─' $col_width)${CYAN}┤${NC}"
            
            printf "${CYAN}│${NC}  ${CYAN}→ Next${NC}%-30s${CYAN}│${NC}" ""
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}  ${CYAN}→ Next${NC}%-30s${CYAN}│${NC}" ""
            echo ""
            
            local next_task
            next_task=$(find_next_task "$ws" 2>/dev/null | head -1)
            if [ -n "$next_task" ]; then
                local ntitle
                ntitle=$(get_task_field "$next_task" "title")
                if [ ${#ntitle} -gt 24 ]; then
                    ntitle="${ntitle:0:21}..."
                fi
                printf "${CYAN}│${NC}    ${CYAN}%s${NC}: %-23s${CYAN}│${NC}" "$next_task" "$ntitle"
                [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    ${CYAN}%s${NC}: %-23s${CYAN}│${NC}" "$next_task" "$ntitle"
                echo ""
            else
                if [ "$ws_done" -eq "$ws_total" ] && [ "$ws_total" -gt 0 ]; then
                    printf "${CYAN}│${NC}    ${GREEN}✓ All done!${NC}                 ${CYAN}│${NC}" ""
                    [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    ${GREEN}✓ All done!${NC}                 ${CYAN}│${NC}" ""
                    echo ""
                else
                    printf "${CYAN}│${NC}    (waiting)                    ${CYAN}│${NC}" ""
                    [ $((row % cols)) -eq 0 ] && printf " ${CYAN}│${NC}    (waiting)                    ${CYAN}│${NC}" ""
                    echo ""
                fi
            fi
            
            printf "${CYAN}└${NC}$(printf '─' $col_width)${CYAN}┘${NC}"
            [ $((row % cols)) -eq 0 ] && printf " ${CYAN}└${NC}$(printf '─' $col_width)${CYAN}┘${NC}"
            echo ""
            
            row=$((row + 1))
        done
        
        local total_errors
        total_errors=$(jq '[.tasks[] | select(.status == "error")] | length' "$TASKS_FILE")
        
        if [ "$total_errors" -gt 0 ]; then
            echo -e "${CYAN}┌${NC}$(printf '─' 78)${CYAN}┐${NC}"
            printf "${CYAN}│${NC}  ${RED}⚠ Errors (%d)${NC}%-66s${CYAN}│${NC}\n" "$total_errors" ""
            echo -e "${CYAN}└${NC}$(printf '─' 78)${CYAN}┘${NC}"
            
            local error_tasks
            error_tasks=$(jq -r '.tasks[] | select(.status == "error") | .id' "$TASKS_FILE")
            while IFS= read -r eid; do
                local etitle eerror
                etitle=$(get_task_field "$eid" "title")
                eerror=$(get_task_field "$eid" "error")
                
                if [ ${#eerror} -gt 60 ]; then
                    eerror="${eerror:0:57}..."
                fi
                
                echo -e "  ${RED}✗${NC} ${YELLOW}$eid${NC}: $etitle"
                echo -e "      ${RED}$eerror${NC}"
            done <<< "$error_tasks"
            echo ""
        fi
        
        sleep "$interval"
    done
}

reset_task() {
    local task_id="$1"
    local current_status
    current_status=$(get_task_field "$task_id" "status")

    if [ "$current_status" = "pending" ]; then
        echo -e "${YELLOW}Task $task_id is already pending.${NC}"
        return
    fi

    update_task "$task_id" "status" "pending"
    update_task "$task_id" "error" "null"
    update_task "$task_id" "started_at" "null"
    update_task "$task_id" "completed_at" "null"
    update_task "$task_id" "files_modified" "[]"
    unlock_task "$task_id"

    local sid_count
    sid_count=$(ls "$LOG_DIR"/${task_id}_*.log.sid 2>/dev/null | wc -l | tr -d ' ')
    if [ "$sid_count" -gt 0 ]; then
        echo -e "${GREEN}Task $task_id reset to pending (session preserved — will resume).${NC}"
    else
        echo -e "${GREEN}Task $task_id reset to pending (fresh start).${NC}"
    fi
}

run_task() {
    local task_id="$1"
    local title description workstream
    title=$(get_task_field "$task_id" "title")
    description=$(get_task_field "$task_id" "description")
    workstream=$(get_task_field "$task_id" "workstream")

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Starting task: ${YELLOW}${task_id}${NC} — ${title}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    lock_task "$task_id"

    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    update_task "$task_id" "status" "in_progress"
    update_task "$task_id" "started_at" "$now"

    while true; do
        local log_file="$LOG_DIR/${task_id}_$(date +%Y%m%d_%H%M%S).log"

        local prev_session_id=""
        local prev_sid_file
        prev_sid_file=$(ls -t "$LOG_DIR"/${task_id}_*.log.sid 2>/dev/null | head -1)
        if [ -n "$prev_sid_file" ] && [ -s "$prev_sid_file" ]; then
            prev_session_id=$(cat "$prev_sid_file")
        fi

        local exit_code=0
        local args
        args=$(get_agent_args)
        if [ -n "$prev_session_id" ]; then
            echo -e "  ${CYAN}Resuming session ${prev_session_id:0:8}...${NC}"
            echo "The previous attempt for task ${task_id} failed or was interrupted. Please continue where you left off and complete the task: ${title}. ${description}" | \
                $AGENT_CMD $args --resume "$prev_session_id" -- - 2>"${log_file}.err" | \
                parse_agent_stream "$log_file" || exit_code=$?
        else
            local prompt
            prompt=$(build_prompt "$task_id")
            echo "$prompt" | $AGENT_CMD $args -- - 2>"${log_file}.err" | \
                parse_agent_stream "$log_file" || exit_code=$?
        fi

        if [ "$exit_code" -ne 0 ] && [ -s "${log_file}.err" ]; then
            echo -e "\n${RED}stderr:${NC}"
            cat "${log_file}.err"
            cat "${log_file}.err" >> "$log_file"
            
            # Check stderr for rate limit errors too
            if grep -qiE "rate limit|usage cap|quota exceeded|too many requests|insufficient credits" "${log_file}.err"; then
                local stderr_content
                stderr_content=$(cat "${log_file}.err")
                echo "$stderr_content" > "${log_file}.ratelimit"
            fi
        fi
        rm -f "${log_file}.err"

        if [ -f "${log_file}.ratelimit" ]; then
            local limit_msg wait_secs
            limit_msg=$(cat "${log_file}.ratelimit")
            wait_secs=$(compute_rate_limit_wait "$limit_msg")
            local wait_min=$(( wait_secs / 60 ))
            local reset_at
            reset_at=$(date -v+${wait_secs}S '+%H:%M' 2>/dev/null || date -d "+${wait_secs} seconds" '+%H:%M' 2>/dev/null || echo "~${wait_min}m")

            echo -e "  ${YELLOW}⏸ Rate limited. Sleeping ${wait_min}m until ~${reset_at}...${NC}"
            rm -f "${log_file}.ratelimit"
            update_task "$task_id" "error" "Rate limited — resuming at ~${reset_at}"
            
            # Save rate limit info for global handling
            echo "$wait_secs" > "$LOCK_DIR/.rate_limit_wait"
            
            return 175  # Special exit code for rate limit
        fi

        break
    done

    if [ "$exit_code" -eq 0 ]; then
        now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        update_task "$task_id" "status" "completed"
        update_task "$task_id" "completed_at" "$now"

        local modified_files
        modified_files=$(grep -oE '(packages|apps|channels|skills|helm|scripts|config|src)/[a-zA-Z0-9_./-]+\.(ts|tsx|js|json|yml|yaml|md|mjs|fga)' "$log_file" | sort -u | head -50 | jq -R -s 'split("\n") | map(select(. != ""))' 2>/dev/null || echo '[]')
        update_task "$task_id" "files_modified" "$modified_files"

        if [ "$AUTO_COMMIT" = "true" ] && git -C "$PROJECT_ROOT" rev-parse --git-dir &>/dev/null; then
            echo -e "  ${BLUE}Committing ${task_id}...${NC}"
            git -C "$PROJECT_ROOT" add -A
            git -C "$PROJECT_ROOT" commit -m "$(cat <<EOF
${task_id}: ${title}

${description}

Workstream: ${workstream} | Task: ${task_id}
Automated by ${LOOP_NAME}
EOF
            )" --no-verify &>/dev/null && \
                echo -e "  ${GREEN}✓ Committed.${NC}" || \
                echo -e "  ${YELLOW}⚠ Nothing to commit.${NC}"
        fi

        rm -f "$LOG_DIR"/${task_id}_*.log.sid

        echo -e "\n${GREEN}✓ Task ${task_id} completed successfully.${NC}"
    else
        update_task "$task_id" "status" "error"
        update_task "$task_id" "error" "${AGENT_CMD^} exited with code $exit_code. See $log_file"
        echo -e "\n${RED}✗ Task ${task_id} failed (exit code $exit_code). Log: $log_file${NC}"
        if [ -f "${log_file}.sid" ]; then
            echo -e "  ${CYAN}Session saved — will resume on retry.${NC}"
        fi
    fi

    unlock_task "$task_id"
    return $exit_code
}

# ─── Main ────────────────────────────────────────────────────────────────────

WORKSTREAM=""
SPECIFIC_TASK=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --workstream)
            WORKSTREAM="$2"
            shift 2
            ;;
        --task)
            SPECIFIC_TASK="$2"
            shift 2
            ;;
        --status)
            show_status
            exit 0
            ;;
        --watch)
            _watch_interval=5
            if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                _watch_interval="$2"
                shift
            fi
            watch_status "$_watch_interval"
            exit 0
            ;;
        --reset)
            reset_task "$2"
            exit 0
            ;;
        --reset-errors)
            errored_ids=$(jq -r '.tasks[] | select(.status == "error") | .id' "$TASKS_FILE")
            if [ -z "$errored_ids" ]; then
                echo "No errored tasks."
            else
                while IFS= read -r tid; do
                    reset_task "$tid"
                done <<< "$errored_ids"
            fi
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

if [ -n "$SPECIFIC_TASK" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo -e "Would run: ${YELLOW}${SPECIFIC_TASK}${NC} — $(get_task_field "$SPECIFIC_TASK" "title")"
        exit 0
    fi
    run_task "$SPECIFIC_TASK"
    exit $?
fi

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}       ${BLUE}${LOOP_NAME} Starting${NC}           ${CYAN}║${NC}"
if [ -n "$WORKSTREAM" ]; then
    echo -e "${CYAN}║${NC}       Workstream: ${YELLOW}${WORKSTREAM}${NC}                         ${CYAN}║${NC}"
fi
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

CONSECUTIVE_FAILURES=0
MAX_CONSECUTIVE_FAILURES=3

while true; do
    local_next=$(find_next_task "$WORKSTREAM" 2>/dev/null || true)

    if [ -z "$local_next" ]; then
        remaining=""
        if [ -n "$WORKSTREAM" ]; then
            remaining=$(jq "[.tasks[] | select(.workstream == \"$WORKSTREAM\" and .status != \"completed\")] | length" "$TASKS_FILE" 2>/dev/null)
        else
            remaining=$(jq '[.tasks[] | select(.status != "completed")] | length' "$TASKS_FILE" 2>/dev/null)
        fi
        remaining=${remaining:-1}

        if [ "$remaining" -eq 0 ]; then
            echo -e "\n${GREEN}All tasks completed!${NC}"
            show_status
            exit 0
        fi

        echo -e "${YELLOW}Waiting for dependencies or locked tasks to complete... (checking every 30s)${NC}"
        sleep 30
        continue
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "Would run: ${YELLOW}${local_next}${NC} — $(get_task_field "$local_next" "title")"
        exit 0
    fi

    task_exit=0
    run_task "$local_next" || task_exit=$?

    # Handle rate limit (exit code 175)
    if [ "$task_exit" -eq 175 ]; then
        local rate_wait
        rate_wait=$(cat "$LOCK_DIR/.rate_limit_wait" 2>/dev/null || echo "3600")
        local wait_min=$(( rate_wait / 60 ))
        local reset_at
        reset_at=$(date -v+${rate_wait}S '+%H:%M' 2>/dev/null || date -d "+${rate_wait} seconds" '+%H:%M' 2>/dev/null || echo "~${wait_min}m")
        
        echo -e "${YELLOW}⏸ Rate limited. Waiting ${wait_min}m for reset at ~${reset_at}...${NC}"
        sleep "$rate_wait"
        rm -f "$LOCK_DIR/.rate_limit_wait"
        
        # Don't count rate limit as failure, just retry
        echo -e "${BLUE}⏵ Retrying task...${NC}"
        run_task "$local_next" || task_exit=$?
    fi

    if [ "$task_exit" -ne 0 ]; then
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
        if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
            echo -e "${RED}${MAX_CONSECUTIVE_FAILURES} consecutive failures. Stopping.${NC}"
            echo -e "${YELLOW}Fix the issues and run: $0 --reset-errors${NC}"
            show_status
            exit 1
        fi
        echo -e "${YELLOW}Task failed. Continuing to next task... ($CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES failures)${NC}"
    else
        CONSECUTIVE_FAILURES=0
    fi

    echo -e "\n${BLUE}Pausing 5s before next task...${NC}\n"
    sleep 5
done
