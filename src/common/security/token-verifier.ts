import { createSecretKey } from "crypto";
import {
  JWTPayload,
  KeyLike,
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as JoseErrors,
  importSPKI,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { EnvironmentConfig } from "../../config/environment";

export type TokenVerificationErrorCode =
  | "missing_token"
  | "malformed_token"
  | "invalid_signature"
  | "invalid_audience"
  | "invalid_issuer"
  | "expired"
  | "not_before"
  | "unauthorized"
  | "internal_error";

export interface TokenVerificationSuccess {
  readonly ok: true;
  readonly userId: string;
  readonly payload: JWTPayload;
}

export interface TokenVerificationFailure {
  readonly ok: false;
  readonly code: TokenVerificationErrorCode;
  readonly message: string;
  readonly cause?: Error;
}

export type TokenVerificationResult =
  | TokenVerificationSuccess
  | TokenVerificationFailure;

function isFailure(
  result: TokenVerificationResult,
): result is TokenVerificationFailure {
  return result.ok === false;
}

const HMAC_ALGORITHMS = new Set(["HS256", "HS384", "HS512"]);

const SUPPORTED_PEM_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
] as const;

export class TokenVerifier {
  private readonly remoteJwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly staticKeyEntries: string[];
  private staticKeys: Map<string, KeyLike[]> = new Map();

  constructor(private readonly config: EnvironmentConfig["auth"]) {
    this.staticKeyEntries = [...config.publicKeys];
    if (config.jwksUrl) {
      this.remoteJwks = createRemoteJWKSet(new URL(config.jwksUrl));
    }
  }

  async verify(
    token: string | null | undefined,
  ): Promise<TokenVerificationResult> {
    if (!token) {
      return {
        ok: false,
        code: "missing_token",
        message: "Handshake token is required",
      };
    }

    let headerAlg: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      headerAlg = header.alg as string | undefined;
    } catch (error) {
      return {
        ok: false,
        code: "malformed_token",
        message: "Token is not a valid JWT",
        cause: error instanceof Error ? error : undefined,
      };
    }

    if (this.remoteJwks) {
      const remoteResult = await this.tryVerifyWithKeyResolver(
        token,
        this.remoteJwks,
      );
      if (remoteResult) {
        if (remoteResult.ok) {
          return remoteResult;
        }
        if (
          isFailure(remoteResult) &&
          remoteResult.code !== "invalid_signature"
        ) {
          return remoteResult;
        }
      }
    }

    const staticResult = await this.tryVerifyWithStaticKeys(token, headerAlg);
    if (staticResult) {
      return staticResult;
    }

    return {
      ok: false,
      code: "invalid_signature",
      message: "Token signature did not match any configured key",
    };
  }

  private async tryVerifyWithKeyResolver(
    token: string,
    resolver: JWTVerifyGetKey,
  ): Promise<TokenVerificationResult | null> {
    try {
      const { payload } = await jwtVerify(token, resolver, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        clockTolerance: this.config.tokenLeewaySec,
      });

      const userId = this.extractUserId(payload);
      if (!userId) {
        return {
          ok: false,
          code: "unauthorized",
          message: "Token does not contain a subject or user identifier",
        };
      }

      return {
        ok: true,
        payload,
        userId,
      };
    } catch (error) {
      return this.mapJoseError(error);
    }
  }

  private async tryVerifyWithStaticKeys(
    token: string,
    algorithm?: string,
  ): Promise<TokenVerificationResult | null> {
    const keys = await this.getStaticKeysForAlgorithm(algorithm);

    for (const key of keys) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: this.config.jwtIssuer,
          audience: this.config.jwtAudience,
          clockTolerance: this.config.tokenLeewaySec,
        });

        const userId = this.extractUserId(payload);
        if (!userId) {
          return {
            ok: false,
            code: "unauthorized",
            message: "Token does not contain a subject or user identifier",
          };
        }

        return {
          ok: true,
          payload,
          userId,
        };
      } catch (error) {
        const mapped = this.mapJoseError(error);
        if (mapped.code !== "invalid_signature") {
          return mapped;
        }
      }
    }

    return null;
  }

  private async getStaticKeysForAlgorithm(
    algorithm?: string,
  ): Promise<KeyLike[]> {
    if (algorithm && this.staticKeys.has(algorithm)) {
      return this.staticKeys.get(algorithm)!;
    }

    const resolvedKeys: KeyLike[] = [];

    for (const entry of this.staticKeyEntries) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith("-----BEGIN")) {
        const candidateAlgorithms = algorithm
          ? [algorithm]
          : SUPPORTED_PEM_ALGORITHMS;
        for (const alg of candidateAlgorithms) {
          try {
            const key = await importSPKI(trimmed, alg);
            resolvedKeys.push(key);
            if (algorithm) {
              break;
            }
          } catch (error) {
            // Try next algorithm
            if (candidateAlgorithms.length === 1) {
              // If we only tried the requested algorithm, log failure
              continue;
            }
          }
        }
      } else if (algorithm && !HMAC_ALGORITHMS.has(algorithm)) {
        // Skip shared secrets when token expects asymmetric algorithm
        continue;
      } else {
        resolvedKeys.push(createSecretKey(Buffer.from(trimmed, "utf-8")));
      }
    }

    if (algorithm) {
      this.staticKeys.set(algorithm, resolvedKeys);
    }

    return resolvedKeys;
  }

  private extractUserId(payload: JWTPayload): string | undefined {
    const candidates = [
      payload.sub,
      (payload as any).user_id,
      (payload as any).uid,
    ];
    return candidates
      .find((value) => typeof value === "string" && value.trim().length > 0)
      ?.trim();
  }

  private mapJoseError(error: unknown): TokenVerificationFailure {
    if (error instanceof JoseErrors.JWTExpired) {
      return {
        ok: false,
        code: "expired",
        message: "Token is expired",
        cause: error,
      };
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      if (error.claim === "aud") {
        return {
          ok: false,
          code: "invalid_audience",
          message: "Token audience is invalid",
          cause: error instanceof Error ? error : undefined,
        };
      }
      if (error.claim === "iss") {
        return {
          ok: false,
          code: "invalid_issuer",
          message: "Token issuer is invalid",
          cause: error instanceof Error ? error : undefined,
        };
      }
      if (error.claim === "nbf") {
        return {
          ok: false,
          code: "not_before",
          message: "Token is not active yet",
          cause: error instanceof Error ? error : undefined,
        };
      }
    }

    if (
      error instanceof JoseErrors.JWKSNoMatchingKey ||
      error instanceof JoseErrors.JWSSignatureVerificationFailed ||
      error instanceof JoseErrors.JOSEAlgNotAllowed
    ) {
      return {
        ok: false,
        code: "invalid_signature",
        message: "Token signature verification failed",
        cause: error instanceof Error ? error : undefined,
      };
    }

    if (error instanceof JoseErrors.JWTInvalid) {
      return {
        ok: false,
        code: "malformed_token",
        message: "Token format is invalid",
        cause: error instanceof Error ? error : undefined,
      };
    }

    return {
      ok: false,
      code: "internal_error",
      message: "Token verification failed due to an unexpected error",
      cause: error instanceof Error ? error : undefined,
    };
  }
}
