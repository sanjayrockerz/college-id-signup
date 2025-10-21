# Disaster Recovery

## Backups
- Hourly snapshots (retain 7 days)
- PITR enabled (restore to any second in last 7 days)

## Restoration Drill (Quarterly)
- Restore 24h-old snapshot
- Validate message integrity
- Target restoration time < 15 minutes

## Commands
```bash
# Example commands (adjust for environment)
pg_restore -U postgres -d chat_backend < backup.dump
```
