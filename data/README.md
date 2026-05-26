# SQLite data (Docker + backups)

**Canonical database file:** `database.db` in this folder.

Docker Compose mounts `./data` → `/app/data` in the backend container (`DATABASE_PATH=/app/data/database.db`).

## Do not lose data

- Use `docker compose down` — **never** `docker compose down -v` (the `-v` flag deletes named volumes; with a bind mount your file stays, but avoid `-v` out of habit).
- Run backups before major upgrades: `.\scripts\backup-database.ps1`

## Restore

- From a backup: `.\scripts\restore-database.ps1 -BackupPath data\backups\database-YYYYMMDD-HHMMSS.db`
- Legacy copy: `backend\database.db` was the pre-Docker dev database; it was copied here during migration.

## Native dev (PyCharm / `start-local-dev.bat`)

Point `DATABASE_PATH` in `backend\.env` to the same file:

```env
DATABASE_PATH=../data/database.db
```

## Admin: user Kite API credentials

Admins with `is_admin` can set or clear a user’s Zerodha API key and secret from **Dashboard → Admin → User Management** (key icon on each row). Saving new credentials clears the user’s stored Kite access token; they must complete **Welcome → Authenticate with Zerodha** again.
