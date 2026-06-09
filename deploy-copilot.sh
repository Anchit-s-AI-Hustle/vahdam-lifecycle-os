#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy this session's Mailer Studio work (Chat+Listen dock, futuristic polish,
# generate.js chat mode) from the canonical repo. Vercel auto-builds on push.
#
# It copies ONLY the two files this session changed from the iCloud working copy
# into the canonical repo, then commits + pushes. The parallel effort's files
# (assets.html, ad-campaigns.html, auth.js, landing-pages.html, vercel.json)
# are untouched. Safe + idempotent.
#
# Run:  bash "deploy-copilot.sh"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/ANCHIT'S AI HUSTLE/Vahdam-LifeCycle-OS"
CANON="${1:-$HOME/dev/anchit-hustle}"   # pass a path as arg if your repo lives elsewhere

echo "▸ Source (iCloud working copy): $SRC"
echo "▸ Canonical repo:              $CANON"
echo

if [ ! -d "$CANON/.git" ]; then
  echo "✗ No git repo at: $CANON"
  echo "  Re-run with the correct path, e.g.:  bash deploy-copilot.sh /path/to/your/repo"
  exit 1
fi

cd "$CANON"

echo "▸ Pulling latest so we sit on top of the parallel work…"
git pull --ff-only || { echo "✗ git pull failed — resolve manually, then re-run."; exit 1; }

echo "▸ Copying the two changed files in…"
cp "$SRC/vahdam_mailer_architect_v34.html" "$CANON/vahdam_mailer_architect_v34.html"
cp "$SRC/api/ai/generate.js"               "$CANON/api/ai/generate.js"

echo
echo "▸ Changes staged for commit:"
git add vahdam_mailer_architect_v34.html api/ai/generate.js
git --no-pager diff --cached --stat
echo

if git diff --cached --quiet; then
  echo "✓ Nothing to deploy — canonical already matches. (Already pushed?)"
  exit 0
fi

git commit -m "feat(studio): unified Chat+Listen dock + futuristic polish; mode:'chat' in generate.js

One common bottom dock: Listen + chat input + send always together; message
history expands above the same bar (collapsed or expanded). On-brand motion
(reduced-motion gated). New mode:'chat' in api/ai/generate.js powers the
assistant; Listen uses the browser SpeechSynthesis API. Light/dark themed."

echo "▸ Pushing… (Vercel will auto-build)"
git push

echo
echo "✅ Pushed. Watch the build at: https://vercel.com/anchittandon-3589s-projects/vahdam-lifecycle-os"
echo "   Live in ~1–2 min at /studio."
