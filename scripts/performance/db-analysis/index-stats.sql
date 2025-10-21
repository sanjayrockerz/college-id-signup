-- Index usage and optimization report for PostgreSQL
WITH index_and_table_stats AS (
    SELECT
        ns.nspname AS schema_name,
        cls.relname AS table_name,
        idxcls.relname AS index_name,
        idxstat.idx_scan,
        idxstat.idx_tup_read,
        idxstat.idx_tup_fetch,
        tblstat.seq_scan,
        tblstat.seq_tup_read,
        tblstat.n_live_tup,
        CASE
            WHEN idxstat.idx_scan = 0 THEN 'unused'
            WHEN idxstat.idx_scan < 10 THEN 'rarely used'
            ELSE 'used'
        END AS index_usage_category,
        CASE
            WHEN tblstat.seq_scan > 1000 AND (tblstat.idx_scan = 0 OR tblstat.seq_scan > tblstat.idx_scan * 10)
                THEN 'High sequential scans relative to index usage'
            ELSE NULL
        END AS table_scan_warning
    FROM pg_stat_user_indexes idxstat
    INNER JOIN pg_class idxcls ON idxcls.oid = idxstat.indexrelid
    INNER JOIN pg_class cls ON cls.oid = idxstat.relid
    INNER JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    INNER JOIN pg_stat_user_tables tblstat ON tblstat.relid = idxstat.relid
),
overall_ratio AS (
    SELECT
        CASE
            WHEN (SUM(tbl.idx_scan) + SUM(tbl.seq_scan)) = 0 THEN NULL
            ELSE (SUM(tbl.idx_scan)::numeric / (SUM(tbl.idx_scan) + SUM(tbl.seq_scan))) * 100
        END AS overall_index_hit_ratio
    FROM pg_stat_user_tables tbl
)
SELECT
    i.schema_name,
    i.table_name,
    i.index_name,
    i.idx_scan,
    i.idx_tup_read,
    i.idx_tup_fetch,
    i.seq_scan,
    i.seq_tup_read,
    i.n_live_tup AS estimated_live_rows,
    ROUND(o.overall_index_hit_ratio, 2) AS overall_index_hit_ratio_pct,
    CASE
        WHEN i.index_usage_category = 'unused' THEN 'Index never used; consider removal if redundant.'
        WHEN i.index_usage_category = 'rarely used' THEN 'Index seldom used; verify necessity.'
        ELSE 'Index actively used.'
    END AS index_usage_comment,
    COALESCE(i.table_scan_warning, 'Normal scan distribution.') AS table_scan_comment
FROM index_and_table_stats i
CROSS JOIN overall_ratio o
ORDER BY
    (i.index_usage_category = 'unused') DESC,
    (i.index_usage_category = 'rarely used') DESC,
    (i.table_scan_warning IS NOT NULL) DESC,
    i.idx_scan ASC,
    i.schema_name,
    i.table_name,
    i.index_name;
