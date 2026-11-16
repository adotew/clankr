#!/bin/sh
# Shows a page in the browser panel of the agent's own clankr thread. The app sets CLANKR_SOCK and CLANKR_THREAD.
[ -n "$1" ] || { echo "usage: clankr-open <url>" >&2; exit 2; }
out=$(printf '%s\t%s\n' "$CLANKR_THREAD" "$*" | nc -U "$CLANKR_SOCK") || exit 1
echo "$out"
case $out in error*) exit 1 ;; esac
