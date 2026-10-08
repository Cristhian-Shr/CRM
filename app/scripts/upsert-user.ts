/**
 * Cria um usuário master ou, se o e-mail já existir, redefine a senha e desbloqueia.
 *   EMAIL=... PASSWORD='...' NAME="..." npm run db:user
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  const email = process.env.EMAIL?.trim().toLowerCase();
  const password = process.env.PASSWORD;
  const name = process.env.NAME ?? "Admin Master";
  if (!email || !password) throw new Error("Defina EMAIL e PASSWORD.");
  const passwordHash = await bcrypt.hash(password, 10);

  const found = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (found) {
    await db
      .update(schema.users)
      .set({ passwordHash, isMaster: true, status: "active", failedLogins: 0, lockedUntil: null })
      .where(eq(schema.users.id, found.id));
    console.log(`Senha redefinida: ${email}`);
  } else {
    await db.insert(schema.users).values({ name, email, passwordHash, isMaster: true });
    console.log(`Usuário master criado: ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
