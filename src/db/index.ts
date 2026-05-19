import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

export function getDb(): Database {
  const { env } = getCloudflareContext();
  return drizzle((env as any).DB, { schema });
}
