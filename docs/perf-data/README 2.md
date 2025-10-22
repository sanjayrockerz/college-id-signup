# Performance Data Directory

**Purpose**: Store synthetic dataset generation metadata and load run history.

## Structure

```
perf-data/
├── run_<timestamp>.json       # Individual load run metadata
├── latest_run.json            # Symlink to most recent run
├── teardown.sh                # Generated cleanup script
└── generation_configs/        # Archived generation configs
    ├── dev_20251022.json
    ├── staging_20251022.json
    └── perf_20251022.json
```

## Load Metadata Format

Each `run_<timestamp>.json` contains:

```json
{
  "run_id": "load_1729612345",
  "schema_name": "perf_synthetic",
  "generation_config": {
    "band": "staging",
    "seed": "staging_20251022_baseline",
    "generated_at": "2025-10-22T10:30:00Z",
    "counts": {
      "users": 150000,
      "conversations": 300000,
      "messages": 100000000,
      "read_receipts": 75000000
    }
  },
  "load_started_at": "2025-10-22T11:00:00Z",
  "load_completed_at": "2025-10-22T11:08:07Z",
  "duration_seconds": 487,
  "rows_loaded": {
    "users": 150000,
    "conversations": 300000,
    "conversation_users": 850000,
    "messages": 100000000,
    "attachments": 15000000,
    "message_reads": 75000000
  },
  "errors": [],
  "status": "COMPLETED"
}
```

## Usage

### Query Recent Loads

```bash
# List recent loads
ls -lt docs/perf-data/run_*.json | head -n 5

# View latest load summary
cat docs/perf-data/latest_run.json

# Check for failed loads
jq -r 'select(.status == "FAILED") | .run_id' docs/perf-data/run_*.json
```

### Archive Old Runs

```bash
# Move runs older than 90 days to archive
find docs/perf-data -name "run_*.json" -mtime +90 -exec mv {} docs/perf-data/archive/ \;
```

### Reproduce Dataset

```bash
# Find seed from previous run
SEED=$(jq -r '.generation_config.seed' docs/perf-data/run_1729612345.json)

# Regenerate with same seed
ts-node scripts/synthetic-data/generator.ts --band staging --seed "$SEED"
```

## Retention Policy

- **Load Metadata**: Keep for 1 year
- **Generation Configs**: Keep for 2 years (reproducibility)
- **Teardown Scripts**: Delete after use or 30 days
- **Failed Run Logs**: Keep for 90 days for debugging

## Related Documentation

- **Privacy Engineering**: `../database/PRIVACY_ENGINEERING.md`
- **Query Baselines**: `../database/baselines/query-catalog.md`
- **Synthetic Data Generator**: `../../scripts/synthetic-data/README.md`
