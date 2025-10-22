import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_FLAGS = [
  "DISABLE_RATE_LIMIT",
  "MOCK_MODE",
  "DEV_SEED_DATA",
] as const;

type ForbiddenFlag = (typeof FORBIDDEN_FLAGS)[number];

const TRUTHY_VALUES = ["true", "1", "yes", "on"];

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const PROD_FILE_PATTERNS: RegExp[] = [
  /^\.env(?:\.production.*)?$/,
  /^deploy\//,
  /^infra\//,
  /^ops\//,
  /^k8s\//,
  /^charts\//,
  /^docker\//,
  /^compose\//,
  /^scripts\/deploy\//,
  /^\.github\/workflows\//,
  /^docker-compose\.ya?ml$/,
  /^helm\//,
];

interface Violation {
  file: string;
  line: number;
  flag: ForbiddenFlag;
  raw: string;
}

function shouldInspect(file: string): boolean {
  return PROD_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

function collectTrackedFiles(): string[] {
  const output = execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" });
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function detectViolations(file: string): Violation[] {
  const absolutePath = path.join(REPO_ROOT, file);
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);

  const violations: Violation[] = [];
  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      return;
    }

    FORBIDDEN_FLAGS.forEach((flag) => {
      if (!trimmed.includes(flag)) {
        return;
      }

      const regex = new RegExp(
        `${flag}\\s*[:=]\\s*(['\"]?)(?:${TRUTHY_VALUES.join("|")})(\\1)?(?![a-zA-Z0-9_])`,
        "i",
      );

      if (regex.test(trimmed)) {
        violations.push({
          file,
          line: index + 1,
          flag,
          raw: rawLine,
        });
      }
    });
  });

  return violations;
}

function main(): void {
  const trackedFiles = collectTrackedFiles();
  const candidates = trackedFiles.filter(shouldInspect);

  const violations = candidates.flatMap(detectViolations);

  if (violations.length === 0) {
    console.log(
      "[ci:verify-prod-flags] ✅ No forbidden production flags detected.",
    );
    return;
  }

  console.error(
    "[ci:verify-prod-flags] ❌ Forbidden production flags detected:",
  );
  violations.forEach((violation) => {
    console.error(
      `  • ${violation.file}:${violation.line} → ${violation.flag}`,
    );
    console.error(`    ${violation.raw.trim()}`);
  });
  console.error(
    "\nFix the files above to ensure production manifests do not disable safety controls.",
  );
  console.error(
    'Allowed values are "false", "0", "no", "off", or removing the flag entirely.',
  );
  process.exitCode = 1;
}

main();
