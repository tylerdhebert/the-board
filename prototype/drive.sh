#!/usr/bin/env bash
# usage: drive.sh "student message"
set -e
cd "$(dirname "$0")"
export PYTHONUTF8=1
STU="$1"
TR="./transcript.md"
touch "$TR"

CODEX() { codex --ask-for-approval never exec -m "$1" --skip-git-repo-check -s read-only -o "$2" - >/dev/null 2>&1; }

# split a raw teacher draft file into MODE + body
parse_mode() { # $1 = raw draft file ; sets globals MODE, BODYFILE
  if head -1 "$1" | grep -qi '^MODE:'; then
    MODE="$(head -1 "$1" | sed -n 's/^[Mm][Oo][Dd][Ee]:[[:space:]]*\([A-Za-z]*\).*/\1/p')"
    tail -n +2 "$1" | sed '/./,$!d' > _body.txt   # drop leading blank lines
  else
    MODE="socratic"; cp "$1" _body.txt
  fi
  if [ -z "$MODE" ]; then MODE="socratic"; fi
}

gate_subst() { # $1 = body file -> writes _gate_in.txt
  BODYF="$1" python - <<'PY'
import os
tpl=open("gate_prompt.md",encoding="utf-8").read()
stu=open("_stu.txt",encoding="utf-8").read()
drf=open(os.environ["BODYF"],encoding="utf-8").read()
mode=open("_mode.txt",encoding="utf-8").read().strip()
out=tpl.replace("{{student_msg}}",stu).replace("{{draft}}",drf).replace("{{mode}}",mode)
open("_gate_in.txt","w",encoding="utf-8").write(out)
PY
}

printf '%s' "$STU" > _stu.txt
printf '\nSTUDENT: %s\n' "$STU" >> "$TR"

# ---- teacher draft ----
{ cat teacher_prompt.md; printf '\n\n## Conversation so far\n'; cat "$TR"
  printf '\n\nProduce ONLY your next reply (starting with the MODE line). No preamble.\n'; } > _teacher_in.txt
CODEX gpt-5.5 _draft.txt < _teacher_in.txt
parse_mode _draft.txt
printf '%s' "$MODE" > _mode.txt
RAW="$(cat _draft.txt)"

# ---- gate (mode-aware) ----
gate_subst _body.txt
CODEX gpt-5.4-mini _verdict.txt < _gate_in.txt
echo "=== TEACHER MODE: $MODE ==="
echo "=== GATE (draft 1) ==="; cat _verdict.txt; echo

# ---- redraft once if REVISE ----
FINALRAW="$RAW"; FINALBODY="$(cat _body.txt)"
if grep -q '"REVISE"' _verdict.txt; then
  NOTE="$(cat _verdict.txt)"
  { cat teacher_prompt.md; printf '\n\n## Conversation so far\n'; cat "$TR"
    printf '\n\nYour previous draft was REJECTED by the safety gate: %s\n' "$NOTE"
    printf 'Rejected draft:\n%s\n\nRewrite it to satisfy the gate for your chosen mode (switch mode if that is the right move). Start with the MODE line. Reply only.\n' "$RAW"
  } > _teacher_in2.txt
  CODEX gpt-5.5 _draft2.txt < _teacher_in2.txt
  parse_mode _draft2.txt
  printf '%s' "$MODE" > _mode.txt
  FINALRAW="$(cat _draft2.txt)"; FINALBODY="$(cat _body.txt)"
  gate_subst _body.txt
  CODEX gpt-5.4-mini _verdict2.txt < _gate_in.txt
  echo "=== TEACHER MODE (redraft): $MODE ==="
  echo "=== GATE (draft 2) ==="; cat _verdict2.txt; echo
fi

# store RAW (with MODE line) in transcript for teacher continuity
printf 'TEACHER: %s\n' "$FINALRAW" >> "$TR"
echo
echo "=== TEACHER (sent to student) ==="
echo "$FINALBODY"
