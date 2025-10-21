// Global test setup
import "reflect-metadata";

if (!process.env.PRISMA_CLIENT_MODE) {
  process.env.PRISMA_CLIENT_MODE = "mock";
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
}
