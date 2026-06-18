import Redis from "ioredis";

if (!process.env["REDIS_URL"]) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redis = new Redis(process.env["REDIS_URL"], {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("error", (err: Error) => {
  console.error("[redis] connection error", { error: err.message });
});

redis.on("connect", () => {
  console.info("[redis] connected");
});
