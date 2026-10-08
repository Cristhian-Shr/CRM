"use server";

import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, requireMaster, setSession } from "@/lib/auth";
import { db, schema, type Tx } from "@/lib/db";
import { audit } from "@/lib/db/tenant";
import { normalizePhone, parseMoney, str } from "@/lib/utils";
import { parseCompanyServices } from "@/lib/services";
import { provisionCompany } from "../provision";
import { safe } from "../safe";

/** Sincroniza os serviços contratados de uma empresa (apaga e regrava). */
async function syncCompanyServices(
  tx: Tx,
  companyId: string,
  services: { service: string; valueCents: number; billing: string }[],
) {
  await tx.delete(schema.companyServices).where(eq(schema.companyServices.companyId, companyId));
  if (services.length)
    await tx.insert(schema.companyServices).values(services.map((s) => ({ ...s, companyId })));
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createCompany(fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({
        name: z.string().min(2, "Informe o nome da empresa."),
        adminName: z.string().min(2, "Informe o nome do admin."),
        adminEmail: z.string().email("E-mail do admin inválido."),
        adminPassword: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
      })
      .parse({
        name: str(fd, "name"),
        adminName: str(fd, "adminName"),
        adminEmail: str(fd, "adminEmail")?.toLowerCase(),
        adminPassword: str(fd, "adminPassword"),
      });

    let slug = slugify(data.name) || "empresa";
    const exists = await db.query.companies.findFirst({ where: eq(schema.companies.slug, slug) });
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;

    const services = parseCompanyServices(fd, parseMoney);

    await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(schema.companies)
        .values({
          name: data.name,
          slug,
          cnpj: str(fd, "cnpj"),
          phone: normalizePhone(str(fd, "phone")),
          email: str(fd, "email"),
          plan: str(fd, "plan") ?? "basic",
        })
        .returning();
      await provisionCompany(tx, company.id);
      await syncCompanyServices(tx, company.id, services);

      let admin = await tx.query.users.findFirst({ where: eq(schema.users.email, data.adminEmail) });
      if (!admin) {
        [admin] = await tx
          .insert(schema.users)
          .values({ name: data.adminName, email: data.adminEmail, passwordHash: await bcrypt.hash(data.adminPassword, 10) })
          .returning();
      }
      await tx.insert(schema.companyMembers).values({
        companyId: company.id,
        userId: admin.id,
        role: "admin",
        isSeller: true,
        color: "#be5574",
      });
      await audit(tx, { userId: user.id, companyId: company.id, action: "company.create", entity: "company", entityId: company.id });
    });
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
  });
}

export async function setCompanyStatus(companyId: string, status: "active" | "suspended") {
  const { user } = await requireMaster();
  await db.update(schema.companies).set({ status, updatedAt: new Date() }).where(eq(schema.companies.id, companyId));
  await audit(db, { userId: user.id, companyId, action: `company.${status}`, entity: "company", entityId: companyId });
  revalidatePath("/master");
  revalidatePath("/master/empresas");
  revalidatePath("/master/vendas");
  revalidatePath("/master/faturamento");
}

export async function setCompanyServices(companyId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const services = parseCompanyServices(fd, parseMoney);
    await db.transaction(async (tx) => {
      await syncCompanyServices(tx, companyId, services);
      await audit(tx, { userId: user.id, companyId, action: "company.services", entity: "company", entityId: companyId });
    });
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
  });
}

// Tabelas com company_id, em ordem de dependência (filhas primeiro) para o delete em cascata.
// order_items e program_items não têm company_id: somem via ON DELETE cascade de orders/programs.
const COMPANY_CHILD_TABLES = [
  "messages",
  "conversations",
  "appointments",
  "contracted_sessions",
  "receivables",
  "quotes",
  "orders",
  "tasks",
  "activities",
  "deal_stage_history",
  "deals",
  "goals",
  "notifications",
  "meta_insights_daily",
  "meta_campaigns",
  "meta_connections",
  "whatsapp_accounts",
  "contacts",
  "programs",
  "procedures",
  "rooms",
  "pipeline_stages",
  "lead_sources",
  "loss_reasons",
  "company_services",
  "service_charges",
  "company_members",
  "audit_logs",
] as const;

/** Exclui uma empresa e TODOS os dados dela. Irreversível. Exige confirmação com o nome exato. */
export async function deleteCompany(companyId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, companyId) });
    if (!company) return { error: "Empresa não encontrada." };
    if (str(fd, "confirm") !== company.name) return { error: "Digite o nome exato da empresa para confirmar." };

    await db.transaction(async (tx) => {
      for (const table of COMPANY_CHILD_TABLES) {
        await tx.execute(sql`delete from ${sql.identifier(table)} where company_id = ${companyId}`);
      }
      await tx.delete(schema.companies).where(eq(schema.companies.id, companyId));
    });
    // Audit após o commit, sem companyId (a empresa já não existe).
    await audit(db, { userId: user.id, action: "company.delete", entity: "company", metadata: { id: companyId, name: company.name } });
    revalidatePath("/master");
    revalidatePath("/master/empresas");
    revalidatePath("/master/vendas");
    revalidatePath("/master/faturamento");
    return { ok: true };
  });
}

export async function setChargeStatus(chargeId: string, status: "paid" | "pending") {
  const { user } = await requireMaster();
  await db
    .update(schema.serviceCharges)
    .set({ status, paidAt: status === "paid" ? new Date() : null })
    .where(eq(schema.serviceCharges.id, chargeId));
  await audit(db, { userId: user.id, action: `charge.${status}`, entity: "charge", entityId: chargeId });
  revalidatePath("/master");
  revalidatePath("/master/faturamento");
}

export async function enterCompany(companyId: string) {
  const { user } = await requireMaster();
  await audit(db, { userId: user.id, companyId, action: "impersonate", entity: "company", entityId: companyId });
  await setSession({ userId: user.id, isMaster: true, activeCompanyId: companyId, impersonating: true });
  redirect("/dashboard");
}

export async function leaveCompany() {
  const session = await getSession();
  if (!session) redirect("/login");
  await setSession({ userId: session.userId, isMaster: session.isMaster, activeCompanyId: null });
  redirect(session.isMaster ? "/master" : "/selecionar-empresa");
}

/** Cria um usuário e o vincula a uma empresa com um nível de acesso. */
export async function createUser(fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({
        name: z.string().min(2, "Informe o nome."),
        email: z.string().email("E-mail inválido."),
        companyId: z.string().uuid("Selecione a empresa."),
        role: z.enum(["admin", "collaborator"]),
        password: z.string().optional(),
      })
      .parse({
        name: str(fd, "name") ?? "",
        email: (str(fd, "email") ?? "").toLowerCase(),
        companyId: str(fd, "companyId") ?? "",
        role: str(fd, "role") ?? "collaborator",
        password: str(fd, "password") ?? undefined,
      });

    const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, data.companyId) });
    if (!company) return { error: "Empresa não encontrada." };

    await db.transaction(async (tx) => {
      let target = await tx.query.users.findFirst({ where: eq(schema.users.email, data.email) });
      if (!target) {
        if (!data.password || data.password.length < 8) throw new Error("Defina uma senha de ao menos 8 caracteres.");
        [target] = await tx
          .insert(schema.users)
          .values({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 10) })
          .returning();
      }
      const member = await tx.query.companyMembers.findFirst({
        where: and(eq(schema.companyMembers.companyId, data.companyId), eq(schema.companyMembers.userId, target.id)),
      });
      if (member) throw new Error("Esse usuário já tem acesso a essa empresa.");
      await tx
        .insert(schema.companyMembers)
        .values({ companyId: data.companyId, userId: target.id, role: data.role, color: "#7c3aed" });
      await audit(tx, { userId: user.id, companyId: data.companyId, action: "user.create", entity: "user", entityId: target.id });
    });
    revalidatePath("/master/usuarios");
    return { ok: true };
  });
}

export async function updateUser(userId: string, fd: FormData) {
  return safe(async () => {
    const { user } = await requireMaster();
    const data = z
      .object({
        name: z.string().min(2, "Informe o nome."),
        email: z.string().email("E-mail inválido."),
        password: z.string().min(8, "A senha precisa de ao menos 8 caracteres.").optional(),
      })
      .parse({
        name: str(fd, "name") ?? "",
        email: (str(fd, "email") ?? "").toLowerCase(),
        password: str(fd, "password") ?? undefined,
      });

    const dup = await db.query.users.findFirst({ where: eq(schema.users.email, data.email) });
    if (dup && dup.id !== userId) return { error: "E-mail já usado por outro usuário." };

    const patch: { name: string; email: string; passwordHash?: string } = { name: data.name, email: data.email };
    if (data.password) patch.passwordHash = await bcrypt.hash(data.password, 10);

    await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
    await audit(db, {
      userId: user.id,
      action: "user.update",
      entity: "user",
      entityId: userId,
      metadata: { passwordChanged: !!data.password },
    });
    revalidatePath("/master/usuarios");
    return { ok: true };
  });
}

export async function setUserStatus(userId: string, status: "active" | "disabled") {
  const { user } = await requireMaster();
  if (userId === user.id) return;
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, userId));
  await audit(db, { userId: user.id, action: `user.${status}`, entity: "user", entityId: userId });
  revalidatePath("/master/usuarios");
}
