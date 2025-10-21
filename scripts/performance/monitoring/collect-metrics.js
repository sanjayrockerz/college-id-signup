#!/usr/bin/env node
/**
 * System metrics collector for performance testing.
 *
 * Usage:
 *   METRICS_INTERVAL=5 OUTPUT_FILE=/tmp/metrics.csv node scripts/performance/monitoring/collect-metrics.js &
 *   # Run your load test...
 *   kill <pid>
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const DEFAULT_INTERVAL_SECONDS = 10;

function resolveOutputPath(filename) {
  const base = filename || `metrics-${new Date().toISOString().replace(/[:]/g, '-')}.csv`;
  if (path.isAbsolute(base)) {
    return base;
  }
  return path.join(process.cwd(), base);
}

const intervalSeconds = Number(process.env.METRICS_INTERVAL || DEFAULT_INTERVAL_SECONDS);
if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
  console.error('Invalid METRICS_INTERVAL value. Must be a positive number.');
  process.exit(1);
}

const outputFile = resolveOutputPath(process.env.OUTPUT_FILE);

let fileHandle;
let sampleCount = 0;
let cpuSum = 0;
let memoryPercentSum = 0;
let loadSum = 0;

function formatCsvRow(values) {
  return `${values.join(',')}\n`;
}

function calculateCpuUsagePercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  cpus.forEach((cpu) => {
    const { user, nice, sys, idle: idleTime, irq } = cpu.times;
    idle += idleTime;
    total += user + nice + sys + idleTime + irq;
  });

  const idleDiff = idle / cpus.length;
  const totalDiff = total / cpus.length;
  const usage = totalDiff === 0 ? 0 : ((totalDiff - idleDiff) / totalDiff) * 100;

  return Number(usage.toFixed(2));
}

function collectMetrics() {
  const timestamp = new Date().toISOString();
  const cpuUsagePercent = calculateCpuUsagePercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsedMB = Number((usedMem / 1024 / 1024).toFixed(2));
  const memoryTotalMB = Number((totalMem / 1024 / 1024).toFixed(2));
  const memoryPercent = Number(((usedMem / totalMem) * 100).toFixed(2));
  const [load1m] = os.loadavg();
  const loadAverage1m = Number(load1m.toFixed(2));

  cpuSum += cpuUsagePercent;
  memoryPercentSum += memoryPercent;
  loadSum += loadAverage1m;
  sampleCount += 1;

  const row = formatCsvRow([
    timestamp,
    cpuUsagePercent,
    memoryUsedMB,
    memoryTotalMB,
    memoryPercent,
    loadAverage1m,
  ]);

  fs.appendFileSync(fileHandle, row, 'utf8');
}

function printSummaryAndExit(exitCode = 0) {
  if (sampleCount === 0) {
    console.log('No samples collected. Exiting.');
    process.exit(exitCode);
    return;
  }

  const cpuAverage = (cpuSum / sampleCount).toFixed(2);
  const memoryAverage = (memoryPercentSum / sampleCount).toFixed(2);
  const loadAverage = (loadSum / sampleCount).toFixed(2);

  console.log(`\nMetrics collection complete. Samples: ${sampleCount}`);
  console.log(`Average CPU usage: ${cpuAverage}%`);
  console.log(`Average memory usage: ${memoryAverage}%`);
  console.log(`Average load (1m): ${loadAverage}`);

  process.exit(exitCode);
}

function setup() {
  if (fs.existsSync(outputFile)) {
    console.warn(`Output file ${outputFile} exists. Appending to existing file.`);
  } else {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(
      outputFile,
      formatCsvRow(['timestamp', 'cpuUsagePercent', 'memoryUsedMB', 'memoryTotalMB', 'memoryPercent', 'loadAverage1m']),
      'utf8',
    );
  }

  fileHandle = fs.openSync(outputFile, 'a');

  const intervalMs = Math.floor(intervalSeconds * 1000);
  const intervalId = setInterval(collectMetrics, intervalMs);

  const shutdown = (signal) => {
    console.log(`\nReceived ${signal}. Finalizing metrics collection...`);
    clearInterval(intervalId);
    try {
      collectMetrics();
    } catch (error) {
      console.error('Failed to capture final metrics sample:', error.message || error);
    }
    try {
      fs.closeSync(fileHandle);
    } catch (error) {
      console.error('Failed to close metrics file:', error.message || error);
    }
    printSummaryAndExit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`Collecting metrics every ${intervalSeconds}s -> ${outputFile}`);
}

setup();
collectMetrics();
