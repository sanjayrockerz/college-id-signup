import { Injectable, Logger } from "@nestjs/common";
import * as https from "https";

interface PushMessagePayload {
  readonly tokens: string[];
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string>;
}

interface PushDeliveryResult {
  readonly success: boolean;
  readonly statusCode: number;
  readonly body: string;
}

@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);
  private readonly fcmEndpoint = "https://fcm.googleapis.com/fcm/send";
  private readonly fcmServerKey = process.env.FCM_SERVER_KEY;

  async sendNotification(
    payload: PushMessagePayload,
  ): Promise<PushDeliveryResult> {
    if (!this.fcmServerKey) {
      this.logger.warn("FCM server key missing, push notification skipped");
      return { success: false, statusCode: 0, body: "missing_fcm_server_key" };
    }

    if (payload.tokens.length === 0) {
      return { success: true, statusCode: 200, body: "no_tokens" };
    }

    const requestBody = JSON.stringify({
      registration_ids: payload.tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
    });

    const options: https.RequestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        Authorization: `key=${this.fcmServerKey}`,
      },
    };

    return new Promise<PushDeliveryResult>((resolve, reject) => {
      const req = https.request(this.fcmEndpoint, options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const success = res.statusCode
            ? res.statusCode >= 200 && res.statusCode < 300
            : false;
          if (!success) {
            this.logger.warn(
              `FCM request failed with status ${res.statusCode}: ${body}`,
            );
          }
          resolve({
            success,
            statusCode: res.statusCode ?? 0,
            body,
          });
        });
      });

      req.on("error", (error) => {
        this.logger.error(
          "FCM request error",
          error instanceof Error ? error : undefined,
        );
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }
}
