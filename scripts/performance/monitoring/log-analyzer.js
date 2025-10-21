#!/usr/bin/env node
/**
 * Log analyzer for performance testing windows.
 *
 * Reads structured JSON logs and produces a Markdown summary of error patterns.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_FILE = process.env.LOG_FILE;
const LOG_START_TIME = process.env.LOG_START_TIME;
const LOG_END_TIME = process.env.LOG_END_TIME;

if (!LOG_FILE) {
  console.error('LOG_FILE env variable is required.');
  process.exit(1);
}

if (!LOG_START_TIME || !LOG_END_TIME) {
  console.error('LOG_START_TIME and LOG_END_TIME env variables are required.');
  process.exit(1);
}

const startTime = new Date(LOG_START_TIME);
const endTime = new Date(LOG_END_TIME);

if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
  console.error('Invalid LOG_START_TIME or LOG_END_TIME. Use ISO8601 format.');
  process.exit(1);
}

if (startTime >= endTime) {
  console.error('LOG_START_TIME must be before LOG_END_TIME.');
  process.exit(1);
}

const outputDir = path.join(process.cwd(), 'docs', 'validation', 'performance');
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(
  outputDir,
  `log-analysis-${new Date().toISOString().replace(/[:]/g, '-')}.md`,
);

const levelCounters = {
  error: 0,
  warn: 0,
  info: 0,
  debug: 0,
  other: 0,
};

const errorBuckets = new Map();
const timelineBuckets = new Map();
let processed = 0;
let withinWindow = 0;

function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

function incrementLevel(level) {
  const normalized = typeof level === 'string' ? level.toLowerCase() : 'other';
  if (normalized in levelCounters) {
    levelCounters[normalized] += 1;
  } else {
    levelCounters.other += 1;
  }
}

function bucketError(entry) {
  if (!entry || typeof entry !== 'object') {
    return;
  }
  const key = [entry.error?.name, entry.error?.message || entry.message, entry.stack?.slice(0, 120)]
    .filter(Boolean)
    .join(' | ');
  if (!key) {
    return;
  }
  const bucket = errorBuckets.get(key) || { count: 0, samples: [] };
  bucket.count += 1;
  if (bucket.samples.length < 3) {
    bucket.samples.push(entry);
  }
  errorBuckets.set(key, bucket);
}

function bucketTimeline(timestamp) {
  const bucketKey = new Date(Math.floor(timestamp.getTime() / (5 * 60 * 1000)) * 5 * 60 * 1000);
  const current = timelineBuckets.get(bucketKey.getTime()) || 0;
  timelineBuckets.set(bucketKey.getTime(), current + 1);
}

async function analyzeLogs() {
  const stream = fs.createReadStream(LOG_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    processed += 1;
    const entry = parseLogLine(line);
    if (!entry) {
      continue;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      continue;
    }

    if (timestamp < startTime || timestamp > endTime) {
      continue;
    }

    withinWindow += 1;
    incrementLevel(entry.level);

    if (entry.level && entry.level.toLowerCase() === 'error') {
      bucketError(entry);
      bucketTimeline(timestamp);
    }
  }
}

function generateReport() {
  const totalEvents = Object.values(levelCounters).reduce((acc, value) => acc + value, 0);
  const errorCount = levelCounters.error;
  const errorRate = totalEvents === 0 ? 0 : ((errorCount / totalEvents) * 100).toFixed(2);

  const topErrors = Array.from(errorBuckets.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const timeline = Array.from(timelineBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketTime, count]) => {
      const bucketDate = new Date(Number(bucketTime)).toISOString();
      return `| ${bucketDate} | ${count} |`;
    });

  const lines = [];
  lines.push('# Log Analysis Report');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Source file: ${LOG_FILE}`);
  lines.push(`- Time window: ${startTime.toISOString()} - ${endTime.toISOString()}`);
  lines.push(`- Events processed: ${processed}`);
  lines.push(`- Events in window: ${withinWindow}`);
  lines.push(`- Error rate: ${errorRate}%`);
  lines.push('');

  lines.push('## Level Distribution');
  lines.push('');
  lines.push('| Level | Count |');
  lines.push('|-------|-------|');
  Object.entries(levelCounters).forEach(([level, count]) => {
    lines.push(`| ${level} | ${count} |`);
  });
  lines.push('');

  lines.push('## Top Errors');
  lines.push('');
  if (topErrors.length === 0) {
    lines.push('No error entries captured in the specified window.');
  } else {
    lines.push('| Error Signature | Count | Sample Context |');
    lines.push('|-----------------|-------|----------------|');
    topErrors.forEach(([signature, bucket]) => {
      const sample = bucket.samples[0];
      const context = sample?.context ? JSON.stringify(sample.context).slice(0, 120) : 'N/A';
      lines.push(`| ${signature.replace(/\n/g, ' ')} | ${bucket.count} | ${context} |`);
    });
  }
  lines.push('');

  lines.push('## Error Timeline (5-minute buckets)');
  lines.push('');
  if (timeline.length === 0) {
    lines.push('No error spikes recorded.');
  } else {
    lines.push('| Interval (UTC) | Error Count |');
    lines.push('|----------------|-------------|');
    timeline.forEach((row) => lines.push(row));
  }
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  if (errorCount === 0) {
    lines.push('- ✅ No errors detected during the specified window. Proceed to validate other telemetry.');
  } else {
    lines.push('- Investigate top error signatures for root cause.');
    lines.push('- Cross-reference error spikes with load-test phases or infrastructure metrics.');
    lines.push('- Review downstream dependencies around peak spike intervals.');
  }
  lines.push('');

  fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
  console.log(`Log analysis report written to ${outputFile}`);
}

(async () => {
  try {
    await analyzeLogs();
    generateReport();
  } catch (error) {
    console.error('Log analysis failed:', error.message || error);
    process.exitCode = 1;
  }
})();
