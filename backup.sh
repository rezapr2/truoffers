#!/usr/bin/env bash
# Nightly MongoDB backup. Keeps the most recent 14 archives.
# Install as a cron job (see README):
#   0 3 * * * /srv/truoffers/backup.sh >> /var/log/truoffers-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/truoffers}"
KEEP="${KEEP:-14}"
ARCHIVE="${BACKUP_DIR}/truoffers-$(date +%F-%H%M).archive.gz"

log() { echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] $*"; }

mkdir -p "$BACKUP_DIR"
log "Backing up to ${ARCHIVE}"

# A failed dump must never leave a truncated file behind that later looks like a
# usable backup, so clean up explicitly rather than letting `set -e` abort first.
if ! docker compose exec -T mongo mongodump --db truoffers --archive --gzip > "$ARCHIVE"; then
  rm -f "$ARCHIVE"
  log "ERROR: mongodump failed — no backup written"
  exit 1
fi

if [[ ! -s "$ARCHIVE" ]]; then
  rm -f "$ARCHIVE"
  log "ERROR: backup archive was empty — removed"
  exit 1
fi

log "Wrote $(du -h "$ARCHIVE" | cut -f1)"

# Rotate: keep only the newest $KEEP archives
ls -1t "${BACKUP_DIR}"/truoffers-*.archive.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  log "Removing old backup ${old}"
  rm -f "$old"
done

log "Done"

# Restore with:
#   docker compose exec -T mongo mongorestore --archive --gzip --drop < BACKUP_FILE
