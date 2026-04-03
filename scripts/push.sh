#!/usr/bin/env bash
# scripts/push.sh — stage, commit, and push all changes to origin/master
# Usage:  ./scripts/push.sh "optional commit message"
#         ./scripts/push.sh          (auto-generates message from changed files)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── 1. Sanity checks ────────────────────────────────────────────────────────
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: not inside a git repo" >&2; exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "→ branch: $BRANCH"

# ── 2. Stage everything (respects .gitignore) ───────────────────────────────
echo "→ staging all changes..."
git add -A

# ── 3. Check if there's actually anything to commit ─────────────────────────
if git diff --cached --quiet; then
  echo "nothing to commit — working tree clean, pushing existing commits..."
else
  # ── 4. Build commit message ──────────────────────────────────────────────
  if [[ -n "${1:-}" ]]; then
    MSG="$1"
  else
    ADDED=$(git diff --cached --name-only --diff-filter=A | wc -l | tr -d ' ')
    MODIFIED=$(git diff --cached --name-only --diff-filter=M | wc -l | tr -d ' ')
    DELETED=$(git diff --cached --name-only --diff-filter=D | wc -l | tr -d ' ')
    PARTS=()
    [[ "$MODIFIED" -gt 0 ]] && PARTS+=("update ${MODIFIED} file(s)")
    [[ "$ADDED"    -gt 0 ]] && PARTS+=("add ${ADDED} file(s)")
    [[ "$DELETED"  -gt 0 ]] && PARTS+=("remove ${DELETED} file(s)")
    MSG="chore: $(IFS=', '; echo "${PARTS[*]}")"
  fi

  echo "→ committing: \"$MSG\""
  git commit -m "$MSG"
fi

# ── 5. Push ──────────────────────────────────────────────────────────────────
echo "→ pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "✓ done — $(git rev-parse --short HEAD) pushed to origin/$BRANCH"
