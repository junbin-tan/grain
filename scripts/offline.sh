#!/bin/sh
# Run a command with all network access denied except loopback (127.0.0.1/localhost),
# using the macOS sandbox. Used to prove Grain's core workflow works offline.
#   scripts/offline.sh <command> [args...]
exec sandbox-exec -p '(version 1)
(allow default)
(deny network*)
(allow network* (remote ip "localhost:*"))
(allow network* (remote unix-socket))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))' "$@"
