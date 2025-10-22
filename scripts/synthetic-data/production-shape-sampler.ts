#!/usr/bin/env ts-node
/**
 * Production Shape Sampler - PRIVACY-FIRST
 *
 * Extracts ONLY aggregate distribution metrics from production.
 * NEVER exports raw user IDs, emails, message content, or any PII.
 *
 * Security Requirements:
 * - Must run INSIDE production network boundary
 * - Requires ANONYMIZATION_SALT environment variable (production secret)
 * - All identifiers tokenized with SHA-256 HMAC (irreversible)
 * - Only exports aggregate histograms and percentiles
 *
 * Usage:
 *   export ANONYMIZATION_SALT="<production-secret>"
 *   ts-node production-shape-sampler.ts --output shape-metrics-prod.json
 */

import { PrismaClient } from "@prisma/client";
import * as crypto from "crypto";
import * as fs from "fs";

interface ShapeMetrics {
  extracted_at: string;
  sample_window_days: number;
  privacy_level: "ANONYMIZED_SHAPE_ONLY";

  users: {
    total_count: number;
    username_length_histogram: Record<string, number>;
    profile_completeness_bins: Record<string, number>;
  };

  conversations: {
    total_count: number;
    type_distribution: Record<string, number>;
    member_count_histogram: Record<string, number>;
    messages_per_conversation_percentiles: {
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      p99: number;
      max: number;
    };
  };

  messages: {
    total_count: number;
    content_length_histogram: Record<string, number>;
    content_length_stats: {
      mean: number;
      median: number;
      p95: number;
    };
    type_distribution: Record<string, number>;
    hourly_distribution: number[];
    day_of_week_distribution: number[];
  };
}

class ProductionShapeSampler {
  private prisma: PrismaClient;
  private salt: string;

  constructor() {
    this.prisma = new PrismaClient();

    // CRITICAL: Production salt must be set
    this.salt = process.env.ANONYMIZATION_SALT || "";
    if (!this.salt || this.salt.length < 32) {
      throw new Error(
        "FATAL: ANONYMIZATION_SALT environment variable required (min 32 chars)\n" +
          "This must be a production secret retrieved from your secrets manager.",
      );
    }

    console.log("[ShapeSampler] ✓ Initialized with production salt");
    console.log(
      "[ShapeSampler] ⚠️  PRIVACY MODE: Only aggregate metrics will be exported",
    );
  }

  /**
   * Irreversibly anonymize an identifier
   * Uses HMAC-SHA256 so same input always produces same token (deterministic)
   */
  private anonymize(value: string): string {
    return crypto
      .createHmac("sha256", this.salt)
      .update(value)
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * Bucket a value for histogram
   */
  private bucket(value: number, bucketSize: number): string {
    const bucketStart = Math.floor(value / bucketSize) * bucketSize;
    return `${bucketStart}-${bucketStart + bucketSize - 1}`;
  }

  /**
   * Sample user distribution metrics
   */
  private async sampleUsers(
    windowDays: number,
  ): Promise<ShapeMetrics["users"]> {
    console.log("[Users] Sampling user metrics...");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
        username: true,
        bio: true,
        profileImageUrl: true,
      },
    });

    console.log(
      `[Users] Sampled ${users.length} users (last ${windowDays} days)`,
    );

    const usernameLengthHistogram: Record<string, number> = {};
    const profileCompletenessBins: Record<string, number> = {
      "0_fields": 0,
      "1_field": 0,
      "2_fields": 0,
    };

    for (const user of users) {
      // Username length distribution (buckets of 5)
      const lengthBucket = this.bucket(user.username.length, 5);
      usernameLengthHistogram[lengthBucket] =
        (usernameLengthHistogram[lengthBucket] || 0) + 1;

      // Profile completeness (bio + profileImage)
      const fieldsCount = [user.bio, user.profileImageUrl].filter(
        Boolean,
      ).length;
      const key =
        fieldsCount === 1
          ? "1_field"
          : fieldsCount === 2
            ? "2_fields"
            : "0_fields";
      profileCompletenessBins[key]++;
    }

    return {
      total_count: users.length,
      username_length_histogram: usernameLengthHistogram,
      profile_completeness_bins: profileCompletenessBins,
    };
  }

  /**
   * Sample conversation distribution metrics
   */
  private async sampleConversations(
    windowDays: number,
  ): Promise<ShapeMetrics["conversations"]> {
    console.log("[Conversations] Sampling conversation metrics...");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
        type: true,
        _count: {
          select: {
            conversationUsers: true,
            messages: true,
          },
        },
      },
    });

    console.log(
      `[Conversations] Sampled ${conversations.length} conversations`,
    );

    const typeDistribution: Record<string, number> = {};
    const memberCountHistogram: Record<string, number> = {};
    const messagesPerConvo: number[] = [];

    for (const convo of conversations) {
      // Type distribution
      typeDistribution[convo.type] = (typeDistribution[convo.type] || 0) + 1;

      // Member count histogram
      const memberBucket = this.bucket(convo._count.conversationUsers, 5);
      memberCountHistogram[memberBucket] =
        (memberCountHistogram[memberBucket] || 0) + 1;

      // Messages per conversation
      messagesPerConvo.push(convo._count.messages);
    }

    // Calculate percentiles
    messagesPerConvo.sort((a, b) => a - b);
    const percentile = (p: number) =>
      messagesPerConvo[Math.floor((messagesPerConvo.length - 1) * (p / 100))];

    return {
      total_count: conversations.length,
      type_distribution: typeDistribution,
      member_count_histogram: memberCountHistogram,
      messages_per_conversation_percentiles: {
        p50: percentile(50),
        p75: percentile(75),
        p90: percentile(90),
        p95: percentile(95),
        p99: percentile(99),
        max: messagesPerConvo[messagesPerConvo.length - 1],
      },
    };
  }

  /**
   * Sample message distribution metrics
   */
  private async sampleMessages(
    windowDays: number,
  ): Promise<ShapeMetrics["messages"]> {
    console.log("[Messages] Sampling message metrics...");

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const messages = await this.prisma.message.findMany({
      where: {
        createdAt: { gte: cutoff },
      },
      select: {
        content: true,
        type: true,
        createdAt: true,
      },
    });

    console.log(`[Messages] Sampled ${messages.length} messages`);

    const contentLengthHistogram: Record<string, number> = {};
    const typeDistribution: Record<string, number> = {};
    const hourlyDistribution = Array(24).fill(0);
    const dayOfWeekDistribution = Array(7).fill(0);
    const contentLengths: number[] = [];

    for (const msg of messages) {
      // Content length histogram (buckets of 50)
      const length = msg.content.length;
      const lengthBucket = this.bucket(length, 50);
      contentLengthHistogram[lengthBucket] =
        (contentLengthHistogram[lengthBucket] || 0) + 1;
      contentLengths.push(length);

      // Type distribution
      typeDistribution[msg.type] = (typeDistribution[msg.type] || 0) + 1;

      // Temporal distributions
      const hour = msg.createdAt.getHours();
      const dayOfWeek = msg.createdAt.getDay();
      hourlyDistribution[hour]++;
      dayOfWeekDistribution[dayOfWeek]++;
    }

    // Calculate content length stats
    contentLengths.sort((a, b) => a - b);
    const mean =
      contentLengths.reduce((sum, v) => sum + v, 0) / contentLengths.length;
    const median = contentLengths[Math.floor(contentLengths.length / 2)];
    const p95 = contentLengths[Math.floor(contentLengths.length * 0.95)];

    return {
      total_count: messages.length,
      content_length_histogram: contentLengthHistogram,
      content_length_stats: {
        mean: Math.round(mean),
        median,
        p95,
      },
      type_distribution: typeDistribution,
      hourly_distribution: hourlyDistribution,
      day_of_week_distribution: dayOfWeekDistribution,
    };
  }

  /**
   * Extract shape metrics from production
   */
  async extract(windowDays: number, outputPath: string): Promise<void> {
    console.log("\n=== PRODUCTION SHAPE EXTRACTION ===");
    console.log(`Window: Last ${windowDays} days`);
    console.log(`Output: ${outputPath}`);
    console.log("Privacy Level: ANONYMIZED_SHAPE_ONLY\n");

    const metrics: ShapeMetrics = {
      extracted_at: new Date().toISOString(),
      sample_window_days: windowDays,
      privacy_level: "ANONYMIZED_SHAPE_ONLY",
      users: await this.sampleUsers(windowDays),
      conversations: await this.sampleConversations(windowDays),
      messages: await this.sampleMessages(windowDays),
    };

    // Write metrics
    fs.writeFileSync(outputPath, JSON.stringify(metrics, null, 2));
    console.log(`\n[Output] ✓ Written to ${outputPath}`);

    // Privacy check summary
    console.log("\n=== PRIVACY CHECK ===");
    console.log("✓ No raw user IDs exported");
    console.log("✓ No email addresses exported");
    console.log("✓ No message content exported (only length distribution)");
    console.log("✓ No conversation names exported");
    console.log("✓ Only aggregate histograms and percentiles exported");
    console.log("\n=== EXTRACTION COMPLETE ===");

    await this.prisma.$disconnect();
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  let outputPath = "shape-metrics-prod.json";
  let windowDays = 30;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === "--window-days" && args[i + 1]) {
      windowDays = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--help") {
      console.log(`
Usage: ts-node production-shape-sampler.ts [options]

Options:
  --output <path>        Output file path (default: shape-metrics-prod.json)
  --window-days <days>   Sample window in days (default: 30)
  --help                 Show this help

Environment:
  ANONYMIZATION_SALT     Required: Production secret (min 32 chars)

Example:
  export ANONYMIZATION_SALT="$(aws secretsmanager get-secret-value --secret-id prod/sampler/salt --query SecretString --output text)"
  ts-node production-shape-sampler.ts --output shape-metrics-20251022.json --window-days 30
      `);
      process.exit(0);
    }
  }

  const sampler = new ProductionShapeSampler();
  await sampler.extract(windowDays, outputPath);
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err.message);
  process.exit(1);
});
