declare module "ioredis-mock" {
  import type RedisClient from "ioredis";

  const RedisMock: typeof RedisClient;
  export = RedisMock;
}
