import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import type { CompanySettings } from "@/lib/db/schema";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type SessionPayload } from "@/lib/session";

export type Role = "admin" | "collaborator";

export type Ctx = {
  userId: string;
  userName: string;
  userEmail: string;
  isMaster: boolean;
  impersonating: boolean;
  companyId: string;
  companyName: string;
  settings: CompanySettings;
  memberId: string | null;
  role: Role;
};

export const getSession = cache(async () => {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
});

export async function setSession(payload: SessionPayload) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(payload), sessionCookieOptions);
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const getUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user || user.status !== "active") return null;
  return { user, session };
});

/** Contexto da empresa ativa. Toda tela e ação da clínica começa por aqui. */
export const getContext = cache(async (): Promise<Ctx> => {
  const found = await getUser();
  if (!found) redirect("/login");
  const { user, session } = found;
  if (!session.activeCompanyId) redirect(user.isMaster ? "/master" : "/selecionar-empresa");

  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, session.activeCompanyId),
  });
  if (!company) redirect("/selecionar-empresa");
  if (company.status !== "active" && !user.isMaster) redirect("/selecionar-empresa?suspensa=1");

  const member = await db.query.companyMembers.findFirst({
    where: and(
      eq(schema.companyMembers.companyId, company.id),
      eq(schema.companyMembers.userId, user.id),
      eq(schema.companyMembers.active, true),
    ),
  });
  if (!member && !user.isMaster) redirect("/selecionar-empresa");

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    isMaster: user.isMaster,
    impersonating: !!session.impersonating,
    companyId: company.id,
    companyName: company.name,
    settings: company.settings ?? {},
    memberId: member?.id ?? null,
    role: user.isMaster ? "admin" : (member!.role as Role),
  };
});

export async function requireMaster() {
  const found = await getUser();
  if (!found) redirect("/login");
  if (!found.user.isMaster) redirect("/dashboard");
  return found;
}
