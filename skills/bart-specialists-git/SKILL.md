---
name: bart-specialists-git
description: |
  Use when the user wants to discover engineering standards from git history and PR reviews.
  Invoke when the user says "analyze git for specialists", "mine PRs for standards",
  "what standards does the team follow", "suggest specialists from git",
  "bart specialists git", or runs /bart-specialists-git. This skill scans GitHub PR
  review comments and commit diffs, extracts patterns where engineers corrected each other,
  groups findings by domain, compares against existing specialist profiles, and recommends
  new specialists to create.
version: 1.0.0
---

# Bart Specialists Git — Mine Standards from Git History

You analyze a project's git history and GitHub PR reviews to reverse-engineer the engineering standards that the team actually enforces. You extract "lessons learned" from code review feedback — moments where one engineer corrected another — then cluster those into domain-specific standards and recommend specialist profiles.

## Input

**Arguments**: $ARGUMENTS

Supported flags:
- `--since <duration>`: Time window to scan. Examples: `3m`, `6m`, `1y`, `2w`. Default: `6m` (6 months).

## Workflow

### Phase 1: Environment Detection

Validate the prerequisites:

```bash
# Check gh CLI is available and authenticated
gh auth status 2>&1 | head -5
```

```bash
# Detect GitHub remote
git remote get-url origin 2>/dev/null || echo "NO_REMOTE"
```

Extract the owner/repo from the remote URL. Support both formats:
- `git@github.com:owner/repo.git` → `owner/repo`
- `https://github.com/owner/repo.git` → `owner/repo`

If `gh auth status` fails, tell the user: "GitHub CLI is not authenticated. Run `gh auth login` first."

If no remote is found, tell the user: "No git remote found. This skill requires a GitHub repository."

Report what you found:
```
Repository: owner/repo
Authenticated: yes
Scan window: [duration, default 6 months]
```

### Phase 2: Fetch PR Review Comments

Use the GitHub API via `gh` to fetch PR review comments within the time window.

```bash
# Get merged PRs from the time window (paginate with --paginate)
gh api "repos/OWNER/REPO/pulls?state=closed&sort=updated&direction=desc&per_page=100" --paginate -q '.[] | select(.merged_at != null) | select(.merged_at >= "SINCE_DATE") | .number' 2>/dev/null | head -200
```

Where `SINCE_DATE` is calculated from the `--since` flag (default: 6 months ago) in ISO 8601 format.

For each PR (cap at 200 PRs to avoid rate limits), fetch review comments:

```bash
# Fetch review comments for a specific PR
gh api "repos/OWNER/REPO/pulls/PR_NUMBER/comments?per_page=100" --paginate -q '.[] | {body: .body, path: .path, diff_hunk: .diff_hunk, user: .user.login, created_at: .created_at}' 2>/dev/null
```

Also fetch PR review bodies (the top-level review summaries):

```bash
gh api "repos/OWNER/REPO/pulls/PR_NUMBER/reviews?per_page=100" -q '.[] | select(.body != null and .body != "") | {body: .body, user: .user.login, state: .state}' 2>/dev/null
```

Focus on comments that indicate a correction or standard enforcement:
- Comments on reviews with state `CHANGES_REQUESTED` or `COMMENTED`
- Comments that contain imperative language ("use X", "don't do Y", "we always Z")
- Comments referencing patterns, conventions, or best practices

Report progress:
```
Fetched reviews from X PRs (Y comments total)
```

### Phase 3: Fetch Local Commit Context

Supplement PR data with local git log analysis:

```bash
# Get commit messages and stats for the time window
git log --since="SINCE_DATE" --pretty=format:"%H|%s|%an|%aI" --stat --no-merges | head -2000
```

```bash
# Get commit messages that reference standards/conventions/fixes
git log --since="SINCE_DATE" --pretty=format:"%s" --no-merges --grep="fix\|refactor\|convention\|style\|lint\|format\|standard\|pattern\|naming" -i | head -200
```

This provides context about what areas of the codebase are actively maintained and what kinds of corrections happen at commit time.

Report progress:
```
Analyzed X commits from local history
```

### Phase 4: Standard Extraction (Batched LLM Analysis)

Process the collected comments in batches of 20-30. For each batch, analyze the comments to extract standards being enforced.

**For each batch, reason through these questions:**

1. What engineering standard or guideline is being enforced in this comment?
2. What domain does this belong to? (backend, frontend, testing, devops, design, API, database, security, etc.)
3. What's the severity? (hard rule vs preference vs suggestion)
4. Can you express this as an imperative rule? ("Always X", "Never Y", "Use Z when...")

**Output format for each extracted standard:**

```
Standard: [imperative rule statement]
Domain: [backend|frontend|testing|devops|design|api|database|security|general]
Evidence: [number of times this pattern appeared in reviews]
Severity: [hard-rule|preference|suggestion]
Example: [brief quote or paraphrase from a review comment]
```

Skip comments that are:
- Pure questions without guidance ("what does this do?")
- Personal style preferences with no team consensus (appeared only once)
- Nitpicks with no pattern (one-off typo fixes)

### Phase 5: Consolidation & Clustering

After all batches are processed, consolidate the findings:

1. **Deduplicate**: Merge standards that express the same rule differently
2. **Cluster by domain**: Group standards into coherent domain profiles
3. **Rank by evidence**: Standards with more review occurrences rank higher
4. **Identify domain profiles**: For each cluster of 3+ standards, a specialist profile is warranted

For each domain cluster, derive:
- **Profile name**: kebab-case identifier (e.g., `api-standards`, `react-patterns`, `test-conventions`)
- **Role**: Natural language role label (e.g., "backend API engineer", "React frontend developer")
- **Premises**: The collected standards, written in imperative voice
- **Evidence strength**: Total number of review comments supporting this cluster

### Phase 6: Compare with Existing Specialists

Load existing specialist profiles:

```bash
bart specialists 2>/dev/null
```

```bash
# Also check project-local specialists
ls .bart/specialists/*.md 2>/dev/null || echo "No project specialists"
ls ~/.bart/specialists/*.md 2>/dev/null || echo "No global specialists"
```

For each existing specialist, read its premises and compare against discovered standards:

**Comparison categories:**
- **Covered**: Standard already exists in a specialist's premises → skip
- **Gap**: Standard discovered in git but not in any specialist → recommend adding
- **Conflict**: Standard in git contradicts a specialist's premises → flag explicitly
- **Outdated**: Specialist has a premise that was actively corrected against in recent PRs → flag

### Phase 7: Recommendations Report

Present a structured report:

```
# Git Standards Analysis Report

Repository: owner/repo
Period: [start_date] to [end_date]
PRs analyzed: X
Review comments processed: Y
Standards extracted: Z

## Discovered Standards by Domain

### [Domain Name] (X standards, Y evidence points)

1. **[Standard]** (evidence: N comments)
   → [imperative rule]
   Example: "[quote from PR review]"

2. **[Standard]** (evidence: N comments)
   → [imperative rule]

### [Another Domain] (X standards, Y evidence points)
...

## Existing Specialist Coverage

### Gaps (standards not covered by any specialist)
- [standard] → Recommended for: [domain-specialist-name]
- [standard] → Recommended for: [domain-specialist-name]

### Conflicts (standards contradicting existing specialists)
- [specialist-name] says "[premise]" but reviews enforce "[different standard]"
  Evidence: N comments

### Well-Covered (already in specialists)
- [standard] → Covered by [specialist-name]

## Recommended New Specialists

| # | Name | Role | Standards | Evidence |
|---|------|------|-----------|----------|
| 1 | [name] | [role] | X standards | Y review comments |
| 2 | [name] | [role] | X standards | Y review comments |

Create these specialists? I can launch `bart specialists new` for each one
with the discovered standards pre-loaded as premises.
```

### Phase 8: Specialist Creation

For each recommended specialist the user approves, prepare the context and invoke creation.

If the user says "yes" or "create all" or selects specific specialists:

For each approved specialist, present the pre-filled profile for confirmation:

```
Creating specialist: [name]
Role: [role]
Premises (from git analysis):

[list of imperative standards discovered]

Shall I create this profile directly, or launch the full guided creation flow
(bart specialists new) to refine it further?
```

**Option A — Direct creation**: Write the profile file immediately using the discovered standards as premises. Place in `.bart/specialists/[name].md` (project-local, since these are project-specific standards).

```markdown
---
name: [name]
description: [auto-generated description from role and domain]
role: [role]
---

## Premises

[standards as imperative rules, one per line]

## Learnings
```

**Option B — Guided creation**: Launch the `bart specialists new` skill with pre-filled context so the user can refine premises, add references, and choose placement:

```
Launching guided creation for [name]...
Pre-filled context: [list of standards]
```

After all specialists are created (or skipped), output the summary:

```
Specialist creation complete:
- Created: [list]
- Skipped: [list]
- Conflicts flagged: [count] (review manually)

Run `bart specialists --board` to see the updated specialist roster.
```

## Rate Limiting & Safety

- Cap at 200 PRs per scan to stay within GitHub API rate limits
- Cap at 100 comments per PR
- If rate-limited, report how far you got and suggest re-running with a narrower `--since` window
- Never expose raw API tokens or auth details in output
- Warn if the repository is private and the user might not have appropriate permissions

## Key Principles

1. **Evidence-based, not speculative** — Every recommended standard must trace back to actual PR review comments
2. **Domain clustering, not flat lists** — Standards are grouped into coherent specialist profiles, not dumped as a raw list
3. **Conflict detection is critical** — The highest-value output is finding where existing specialists disagree with actual team practice
4. **Batch for reliability** — Process comments in manageable chunks, not one massive context dump
5. **User controls creation** — Present recommendations, let the user decide what to create. Never auto-create specialists without approval
6. **Project-local by default** — Git-mined standards are project-specific; default to `.bart/specialists/` placement
7. **Progressive disclosure** — Show the summary report first; let users drill into specific domains or conflicts on request
