#!/usr/bin/env bash
set -Eeuo pipefail

restic snapshots
restic check
