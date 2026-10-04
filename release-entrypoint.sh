#!/bin/sh
# PID 1 setup for the web image: publish this image's browser assets into the
# shared release volume before Next starts or turns healthy (see
# scripts/RETAINED-ASSETS.md), then exec the server. Descriptor 9 is a shared
# kernel lease on this image's release; exec keeps it open in the server
# process, so the store cannot prune these assets until the server has exited.
set -eu
release_sha=$(node /usr/local/lib/releases/shared-asset-releases.mjs check)
store=/var/lib/chemistry-sketcher-releases
mkdir -p "$store/leases"
exec 9>"$store/leases/$release_sha.lock"
flock -s 9
exec 8>"$store/.publish.lock"
flock -x 8
node /usr/local/lib/releases/shared-asset-releases.mjs publish
flock -u 8
exec 8>&-
exec "$@"
