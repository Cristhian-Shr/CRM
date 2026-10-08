import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import ws from "ws";
import * as schema from "./schema";

// No Neon usamos o driver serverless (WebSocket, aceita transações).
// Em desenvolvimento com Postgres local usamos o driver "pg" comum.
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  if (url.includes("neon.tech")) {
    neonConfig.webSocketConstructor = ws;
    return drizzleNeon(new NeonPool({ connectionString: url }), { schema });
  }
  return drizzlePg(new PgPool({ connectionString: url }), { schema }) as unknown as ReturnType<typeof drizzleNeon<typeof schema>>;
}

type Database = ReturnType<typeof createDb>;
const globalForDb = globalThis as unknown as { db?: Database };

// Conexão criada no primeiro uso (o build do Next importa os módulos sem DATABASE_URL).
export const db = new Proxy({} as Database, {
  get(_, prop) {
    globalForDb.db ??= createDb();
    const value = Reflect.get(globalForDb.db, prop);
    return typeof value === "function" ? value.bind(globalForDb.db) : value;
  },
});

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
