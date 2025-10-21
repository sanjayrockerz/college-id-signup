#!/usr/bin/env python3
"""Run a psql command with a hard timeout to prevent terminal hangs."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from typing import List
from urllib.parse import urlsplit, urlunsplit


def sanitize_dsn(dsn: str | None) -> str | None:
    if not dsn:
        return dsn

    parsed = urlsplit(dsn)
    if not parsed.query:
        return dsn

    sanitized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', parsed.fragment))
    return sanitized


def build_psql_command(args: argparse.Namespace) -> List[str]:
    command: List[str] = ["psql", "-X"]

    dsn = sanitize_dsn(args.dsn)
    if dsn:
        command.extend([dsn])
    else:
        if args.host:
            command.extend(["-h", args.host])
        if args.port:
            command.extend(["-p", str(args.port)])
        if args.username:
            command.extend(["-U", args.username])
        if args.database:
            command.extend(["-d", args.database])

    if args.on_error_stop:
        command.extend(["-v", "ON_ERROR_STOP=1"])

    if args.command:
        command.extend(["-c", args.command])
    elif args.file:
        command.extend(["-f", args.file])

    return command


def main() -> int:
    parser = argparse.ArgumentParser(description="Run psql with timeout protection.")
    parser.add_argument("--dsn", help="Full PostgreSQL connection string (overrides host/port/user/db).")
    parser.add_argument("--host", help="PostgreSQL host name.")
    parser.add_argument("--port", type=int, help="PostgreSQL port number.")
    parser.add_argument("--username", "-U", help="PostgreSQL user name.")
    parser.add_argument("--database", "-d", help="Database name.")
    parser.add_argument("--password", help="Password (falls back to PGPASSWORD env variable).")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout in seconds (default: 30).")
    parser.add_argument("--command", "-c", help="Inline SQL command to execute.")
    parser.add_argument("--file", "-f", help="Path to SQL file to execute.")
    parser.add_argument("--no-pager", action="store_true", help="Disable psql pager to avoid interactive blocking.")
    parser.add_argument("--on-error-stop", action="store_true", help="Abort on first SQL error.")
    parsed = parser.parse_args()

    if not parsed.command and not parsed.file:
        parser.error("Either --command or --file must be provided.")

    env = os.environ.copy()
    if parsed.password:
        env["PGPASSWORD"] = parsed.password

    command = build_psql_command(parsed)

    if parsed.no_pager:
        command.extend(["-P", "pager=off"])

    try:
        process = subprocess.Popen(command, env=env)
    except FileNotFoundError:
        print("psql executable not found. Please install PostgreSQL client tools.", file=sys.stderr)
        return 127

    try:
        return_code = process.wait(timeout=parsed.timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        print(f"psql command timed out after {parsed.timeout} seconds", file=sys.stderr)
        return 124

    return return_code


if __name__ == "__main__":
    sys.exit(main())
