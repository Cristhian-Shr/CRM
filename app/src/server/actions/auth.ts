"use server";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, getUser, setSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/db/tenant";
import { safe, type ActionResult } from "../safe";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Hash fixo p/ equalizar o tempo do bcrypt quando o usuário não existe (evita enumeração por timing).
const DUMMY_HASH = bcrypt.hashSync("no-such-user-placeholder", 10);

export async function login(fd: FormData): Promise<ActionResult> {
  const result = await safe(async () => {
    const { email, password } = z
      .object({ email: z.string().email("Informe um e-mail válido."), password: z.string().min(1, "Informe a senha.") })
      .parse({ email: String(fd.get("email") ?? "").toLowerCase().trim(), password: fd.get("password") });

    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (!user || user.status !== "active") {
      await bcrypt.compare(String(password), DUMMY_HASH); // gasta o mesmo tempo de um login real
      return { error: "E-mail ou senha incorretos." };
    }
    if (user.lockedUntil && user.lockedUntil > new Date())
      return { error: `Acesso bloqueado por ${LOCK_MINUTES} minutos após várias tentativas. Tente mais tarde.` };

    if (!(await bcrypt.compare(String(password), user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await db
        .update(schema.users)
        .set({
          failedLogins: failed >= MAX_ATTEMPTS ? 0 : failed,
          lockedUntil: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(schema.users.id, user.id));
      return { error: "E-mail ou senha incorretos." };
    }

    await db
      .update(schema.users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(schema.users.id, user.id));

    const memberships = await db
      .select({ companyId: schema.companyMembers.companyId })
      .from(schema.companyMembers)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.companyMembers.companyId))
      .where(
        and(
          eq(schema.companyMembers.userId, user.id),
          eq(schema.companyMembers.active, true),
          eq(schema.companies.status, "active"),
        ),
      );

    const activeCompanyId = memberships.length === 1 ? memberships[0].companyId : null;
    await setSession({ userId: user.id, isMaster: user.isMaster, activeCompanyId });
    await audit(db, { userId: user.id, companyId: activeCompanyId, action: "login" });
    return { ok: true, id: activeCompanyId ? "dashboard" : user.isMaster ? "master" : "selecionar-empresa" };
  });
  if (result && "id" in result && result.id) redirect(`/${result.id}`);
  return result;
}

export async function logout() {
  await clearSession();
  redirect("/login");
}

export async function selectCompany(companyId: string) {
  const found = await getUser();
  if (!found) redirect("/login");
  const member = await db.query.companyMembers.findFirst({
    where: and(
      eq(schema.companyMembers.userId, found.user.id),
      eq(schema.companyMembers.companyId, companyId),
      eq(schema.companyMembers.active, true),
    ),
  });
  if (!member && !found.user.isMaster) throw new Error("Sem acesso a esta empresa.");
  await setSession({ userId: found.user.id, isMaster: found.user.isMaster, activeCompanyId: companyId });
  redirect("/dashboard");
}
