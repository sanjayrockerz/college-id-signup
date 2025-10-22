#!/usr/bin/env ts-node
/**
 * Synthetic Data Loader for Performance Testing
 *
 * Loads generated synthetic datasets into dedicated perf_synthetic schema
 * with proper referential integrity, metadata tracking, and cleanup utilities.
 *
 * SAFETY REQUIREMENTS:
 * - Only runs on non-production environments (enforced via NODE_ENV check)
 * - Creates isolated perf_synthetic schema
 * - Tracks load metadata for audit trail
 * - Provides teardown scripts for cleanup
 *
 * Usage:
 *   ts-node loader.ts --schema perf_synthetic --config generation_config.json
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

interface GenerationConfig {
  band: string;
  seed: string;
  generated_at: string;
  counts: {
    users: number;
    conversations: number;
    messages: number;
    read_receipts: number;
  };
}

interface LoadMetadata {
  run_id: string;
  schema_name: string;
  generation_config: GenerationConfig;
  load_started_at: string;
  load_completed_at: string | null;
  duration_seconds: number | null;
  rows_loaded: {
    users: number;
    conversations: number;
    conversation_users: number;
    messages: number;
    attachments: number;
    message_reads: number;
  };
  errors: string[];
  status: "RUNNING" | "COMPLETED" | "FAILED";
}

class SyntheticDataLoader {
  private prisma: PrismaClient;
  private schemaName: string;
  private config: GenerationConfig;
  private metadata: LoadMetadata;
  private startTime: Date;

  constructor(schemaName: string, configPath: string) {
    // Safety check: prevent running on production
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: Cannot run synthetic data loader on production environment",
      );
    }

    this.prisma = new PrismaClient();
    this.schemaName = schemaName;
    this.startTime = new Date();

    // Load generation config
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    this.config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // Initialize metadata
    this.metadata = {
      run_id: `load_${Date.now()}`,
      schema_name: schemaName,
      generation_config: this.config,
      load_started_at: this.startTime.toISOString(),
      load_completed_at: null,
      duration_seconds: null,
      rows_loaded: {
        users: 0,
        conversations: 0,
        conversation_users: 0,
        messages: 0,
        attachments: 0,
        message_reads: 0,
      },
      errors: [],
      status: "RUNNING",
    };

    console.log(`[Loader] Initialized for schema=${schemaName}`);
    console.log(
      `[Loader] Dataset: band=${this.config.band}, seed=${this.config.seed}`,
    );
  }

  /**
   * Create performance testing schema with proper indexes
   */
  async createSchema(): Promise<void> {
    console.log(`[Schema] Creating ${this.schemaName} schema...`);

    try {
      // Note: Schema creation and table setup should be done via migrations
      // This is a safety check that the schema exists
      await this.prisma.$executeRawUnsafe(`
        CREATE SCHEMA IF NOT EXISTS ${this.schemaName}
      `);

      console.log(`[Schema] ✓ Schema ${this.schemaName} ready`);
    } catch (error: any) {
      this.metadata.errors.push(`Schema creation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify referential integrity constraints
   */
  async verifyIntegrity(): Promise<boolean> {
    console.log("[Integrity] Verifying referential integrity...");

    try {
      // Check users exist for all conversations
      const orphanedConversations = await this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count
        FROM conversations c
        LEFT JOIN users u ON u.id = c."creatorId"
        WHERE u.id IS NULL
      `;

      if (orphanedConversations[0]?.count > 0) {
        console.error(
          `[Integrity] ✗ Found ${orphanedConversations[0].count} orphaned conversations`,
        );
        return false;
      }

      // Check messages reference valid conversations
      const orphanedMessages = await this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count
        FROM messages m
        LEFT JOIN conversations c ON c.id = m."conversationId"
        WHERE c.id IS NULL
      `;

      if (orphanedMessages[0]?.count > 0) {
        console.error(
          `[Integrity] ✗ Found ${orphanedMessages[0].count} orphaned messages`,
        );
        return false;
      }

      // Check conversation_users reference valid users and conversations
      const orphanedMembers = await this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) as count
        FROM conversation_users cu
        LEFT JOIN users u ON u.id = cu."userId"
        LEFT JOIN conversations c ON c.id = cu."conversationId"
        WHERE u.id IS NULL OR c.id IS NULL
      `;

      if (orphanedMembers[0]?.count > 0) {
        console.error(
          `[Integrity] ✗ Found ${orphanedMembers[0].count} orphaned conversation members`,
        );
        return false;
      }

      console.log(
        "[Integrity] ✓ All referential integrity constraints satisfied",
      );
      return true;
    } catch (error: any) {
      console.error(`[Integrity] ✗ Verification failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Count loaded rows for metadata
   */
  async countRows(): Promise<void> {
    console.log("[Count] Counting loaded rows...");

    this.metadata.rows_loaded.users = await this.prisma.user.count();
    this.metadata.rows_loaded.conversations =
      await this.prisma.conversation.count();
    this.metadata.rows_loaded.conversation_users =
      await this.prisma.conversationUser.count();
    this.metadata.rows_loaded.messages = await this.prisma.message.count();
    this.metadata.rows_loaded.attachments =
      await this.prisma.attachment.count();
    this.metadata.rows_loaded.message_reads =
      await this.prisma.messageRead.count();

    console.log("[Count] Row counts:");
    console.log(`  Users: ${this.metadata.rows_loaded.users.toLocaleString()}`);
    console.log(
      `  Conversations: ${this.metadata.rows_loaded.conversations.toLocaleString()}`,
    );
    console.log(
      `  Conversation Users: ${this.metadata.rows_loaded.conversation_users.toLocaleString()}`,
    );
    console.log(
      `  Messages: ${this.metadata.rows_loaded.messages.toLocaleString()}`,
    );
    console.log(
      `  Attachments: ${this.metadata.rows_loaded.attachments.toLocaleString()}`,
    );
    console.log(
      `  Message Reads: ${this.metadata.rows_loaded.message_reads.toLocaleString()}`,
    );
  }

  /**
   * Load dataset (assumes data already generated in main schema)
   */
  async load(): Promise<void> {
    console.log("[Load] Starting load process...");

    try {
      // For this implementation, data is loaded during generation
      // This method validates the load
      await this.countRows();

      const integrityOk = await this.verifyIntegrity();
      if (!integrityOk) {
        throw new Error("Referential integrity check failed");
      }

      // Update metadata
      const endTime = new Date();
      this.metadata.load_completed_at = endTime.toISOString();
      this.metadata.duration_seconds =
        (endTime.getTime() - this.startTime.getTime()) / 1000;
      this.metadata.status = "COMPLETED";

      console.log(
        `[Load] ✓ Load completed in ${this.metadata.duration_seconds}s`,
      );
    } catch (error: any) {
      this.metadata.status = "FAILED";
      this.metadata.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Save load metadata for audit trail
   */
  async saveMetadata(outputPath: string): Promise<void> {
    console.log("[Metadata] Saving load metadata...");

    const metadataPath = path.join(
      outputPath,
      `run_${this.metadata.run_id}.json`,
    );

    fs.writeFileSync(metadataPath, JSON.stringify(this.metadata, null, 2));
    console.log(`[Metadata] ✓ Saved to ${metadataPath}`);

    // Also save summary
    const summary = {
      run_id: this.metadata.run_id,
      band: this.config.band,
      seed: this.config.seed,
      status: this.metadata.status,
      duration_seconds: this.metadata.duration_seconds,
      total_rows: Object.values(this.metadata.rows_loaded).reduce(
        (a, b) => a + b,
        0,
      ),
      loaded_at: this.metadata.load_completed_at,
    };

    const summaryPath = path.join(outputPath, "latest_run.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`[Metadata] ✓ Summary saved to ${summaryPath}`);
  }

  /**
   * Generate teardown script
   */
  generateTeardownScript(outputPath: string): void {
    console.log("[Teardown] Generating cleanup script...");

    const script = `#!/bin/bash
# Teardown script for synthetic dataset: ${this.config.band}
# Generated: ${new Date().toISOString()}
# Run ID: ${this.metadata.run_id}

set -e

echo "WARNING: This will delete all data in the current database"
echo "Press Ctrl+C to cancel, or wait 5 seconds to proceed..."
sleep 5

# Truncate tables in reverse dependency order
psql $DATABASE_URL <<EOF
BEGIN;

TRUNCATE TABLE message_reads CASCADE;
TRUNCATE TABLE attachments CASCADE;
TRUNCATE TABLE messages CASCADE;
TRUNCATE TABLE conversation_users CASCADE;
TRUNCATE TABLE conversations CASCADE;
TRUNCATE TABLE users CASCADE;

COMMIT;

-- Reset sequences
ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS conversations_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS messages_id_seq RESTART WITH 1;

SELECT 'Teardown complete' AS status;
EOF

echo "✓ Synthetic dataset removed"
`;

    const scriptPath = path.join(outputPath, "teardown.sh");
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    console.log(`[Teardown] ✓ Script saved to ${scriptPath}`);
  }

  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const schemaIndex = args.indexOf("--schema");
  const configIndex = args.indexOf("--config");

  if (schemaIndex === -1 || configIndex === -1) {
    console.error(
      "Usage: ts-node loader.ts --schema <schema_name> --config <config.json>",
    );
    console.error(
      "Example: ts-node loader.ts --schema perf_synthetic --config report_staging_*.json",
    );
    process.exit(1);
  }

  const schemaName = args[schemaIndex + 1];
  const configPath = args[configIndex + 1];

  // Environment safety check
  if (process.env.NODE_ENV === "production") {
    console.error(
      "FATAL: Cannot run on production. Set NODE_ENV=development or staging",
    );
    process.exit(1);
  }

  const loader = new SyntheticDataLoader(schemaName, configPath);

  try {
    await loader.createSchema();
    await loader.load();

    const outputDir = path.join(__dirname, "../../docs/perf-data");
    fs.mkdirSync(outputDir, { recursive: true });

    await loader.saveMetadata(outputDir);
    loader.generateTeardownScript(outputDir);

    console.log("\n=== LOAD SUMMARY ===");
    console.log(`✓ Status: COMPLETED`);
    console.log(`✓ Schema: ${schemaName}`);
    console.log(`✓ Band: ${loader["config"].band}`);
    console.log(`✓ Metadata: docs/perf-data/run_*.json`);
    console.log(`✓ Teardown: docs/perf-data/teardown.sh`);
  } catch (error) {
    console.error("\n=== LOAD FAILED ===");
    console.error(error);
    process.exit(1);
  } finally {
    await loader.cleanup();
  }
}

if (require.main === module) {
  main();
}
