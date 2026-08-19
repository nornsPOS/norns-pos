# Postgres initdb scripts — local dev only

Files in this directory are executed **once** by the official Postgres entry
point, on a fresh data volume. They run as the superuser created by
`POSTGRES_USER` in docker-compose.yml (`warehouse14` in our case).

## Execution order

Postgres runs `*.sh` and `*.sql` in alphabetical order. The numeric prefix
locks the order:

| File | Purpose |
|---|---|
| `00-create-migrator-role.sh` | Creates `warehouse14_migrator` (CREATEROLE) so migration 0003 can run. |
| `01-set-app-password.sh` | Pre-seeds `warehouse14_app` password so the first `pnpm db:migrate` + `pnpm dev` works without extra steps. |

## Re-running on an existing volume

`initdb.d` is skipped when the data directory already contains a Postgres
cluster. To reset:

```bash
docker compose -f infrastructure/docker/docker-compose.yml down -v
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

The `-v` flag is the important part — it deletes the `warehouse14-pgdata`
volume so initdb runs again.

## Production parallel

These files are **never** used in production. The production parallel lives in
`scripts/bootstrap-oracle.sh` and reads passwords from Oracle Vault per
ADR-0012 §7. The dev convenience here exists so a new developer can
`docker compose up && pnpm install && pnpm db:migrate && pnpm dev` and have a
working environment, without learning the production-bootstrap discipline on
day one.
