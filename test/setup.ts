// Global test setup
import "reflect-metadata";

if (!process.env.PRISMA_CLIENT_MODE) {
  process.env.PRISMA_CLIENT_MODE = "mock";
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
}

if (!process.env.JWT_ISSUER) {
  process.env.JWT_ISSUER = "https://issuer.example.com";
}

if (!process.env.JWT_AUDIENCE) {
  process.env.JWT_AUDIENCE = "chat-backend";
}

if (!process.env.PUBLIC_KEYS) {
  process.env.PUBLIC_KEYS =
    "-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----";
}
