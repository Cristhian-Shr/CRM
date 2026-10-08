/**
 * Cria o usuário master e (opcional) uma clínica de demonstração.
 *   MASTER_EMAIL=... MASTER_PASSWORD=... npm run db:seed
 *   DEMO=1 npm run db:seed   → também cria a "Clínica Demo" com dados de exemplo
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import { DEFAULT_LOSS_REASONS, DEFAULT_SOURCES, DEFAULT_STAGES } from "../src/server/provision";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function upsertUser(name: string, email: string, password: string, isMaster = false) {
  const found = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (found) return found;
  const [u] = await db
    .insert(schema.users)
    .values({ name, email, isMaster, passwordHash: await bcrypt.hash(password, 10) })
    .returning();
  return u;
}

async function main() {
  const email = process.env.MASTER_EMAIL;
  const password = process.env.MASTER_PASSWORD;
  if (!email || !password) throw new Error("Defina MASTER_EMAIL e MASTER_PASSWORD.");
  const master = await upsertUser("Admin Master", email.toLowerCase(), password, true);
  console.log(`Master: ${master.email}`);

  if (!process.env.DEMO) return;
  const exists = await db.query.companies.findFirst({ where: eq(schema.companies.slug, "clinica-demo") });
  if (exists) return console.log("Clínica Demo já existe.");

  const [company] = await db.insert(schema.companies).values({ name: "Clínica Demo", slug: "clinica-demo" }).returning();
  const cid = company.id;
  const stages = await db
    .insert(schema.pipelineStages)
    .values(DEFAULT_STAGES.map((s, i) => ({ ...s, companyId: cid, position: i + 1 })))
    .returning();
  const sources = await db.insert(schema.leadSources).values(DEFAULT_SOURCES.map((s) => ({ ...s, companyId: cid }))).returning();
  await db.insert(schema.lossReasons).values(DEFAULT_LOSS_REASONS.map((name) => ({ name, companyId: cid })));
  const rooms = await db
    .insert(schema.rooms)
    .values(["Avaliação", "Estética 1", "Estética 2"].map((name) => ({ companyId: cid, name })))
    .returning();

  const admin = await upsertUser("Ana Gestora", "admin@demo.com", "demo12345");
  const seller = await upsertUser("Bruna Vendas", "vendas@demo.com", "demo12345");
  const prof = await upsertUser("Carla Esteticista", "carla@demo.com", "demo12345");
  const [mAdmin, mSeller, mProf] = await db
    .insert(schema.companyMembers)
    .values([
      { companyId: cid, userId: admin.id, role: "admin", color: "#be5574" },
      { companyId: cid, userId: seller.id, role: "collaborator", color: "#6366f1", jobTitle: "Consultora" },
      { companyId: cid, userId: prof.id, role: "collaborator", isSeller: false, isProfessional: true, color: "#0ea5e9", jobTitle: "Esteticista" },
    ])
    .returning();

  const procs = await db
    .insert(schema.procedures)
    .values([
      { companyId: cid, name: "Drenagem linfática", category: "Corporal", priceCents: 18000, durationMinutes: 60 },
      { companyId: cid, name: "Radiofrequência", category: "Corporal", priceCents: 25000, durationMinutes: 45 },
      { companyId: cid, name: "Limpeza de pele", category: "Facial", priceCents: 22000, durationMinutes: 60 },
      { companyId: cid, name: "Avaliação", category: "Avaliação", priceCents: 0, durationMinutes: 30 },
    ])
    .returning();
  const [program] = await db
    .insert(schema.programs)
    .values({ companyId: cid, name: "Programa Corpo Verão", priceCents: 250000, validityDays: 120, description: "10 drenagens + 5 radiofrequências" })
    .returning();
  await db.insert(schema.programItems).values([
    { programId: program.id, procedureId: procs[0].id, sessions: 10 },
    { programId: program.id, procedureId: procs[1].id, sessions: 5 },
  ]);

  const names = ["Juliana Martins", "Patrícia Souza", "Fernanda Lima", "Camila Rocha", "Larissa Alves", "Mariana Costa", "Renata Dias", "Beatriz Nunes"];
  for (const [i, name] of names.entries()) {
    const stage = stages[i % 5];
    const owner = i % 2 ? mSeller : mAdmin;
    const [c] = await db
      .insert(schema.contacts)
      .values({
        companyId: cid,
        name,
        phone: `+55519999900${String(i).padStart(2, "0")}`,
        whatsapp: `+55519999900${String(i).padStart(2, "0")}`,
        ownerId: owner.id,
        sourceId: sources[i % sources.length].id,
        status: stage.kind === "won" ? "client" : "lead",
      })
      .returning();
    const [d] = await db
      .insert(schema.deals)
      .values({
        companyId: cid,
        contactId: c.id,
        stageId: stage.id,
        ownerId: owner.id,
        title: i % 3 ? "Programa Corpo Verão" : "Limpeza de pele",
        valueCents: i % 3 ? 250000 : 22000,
        position: i,
        wonAt: stage.kind === "won" ? new Date() : null,
        stageEnteredAt: new Date(Date.now() - i * 86_400_000),
      })
      .returning();
    await db.insert(schema.activities).values({ companyId: cid, contactId: c.id, dealId: d.id, type: "lead_created", payload: { name } });
    if (i < 4) {
      await db.insert(schema.tasks).values({
        companyId: cid,
        contactId: c.id,
        dealId: d.id,
        assignedTo: owner.id,
        title: `Retornar contato de ${name.split(" ")[0]}`,
        dueAt: new Date(Date.now() + (i - 1) * 3_600_000),
        remindAt: new Date(Date.now() + (i - 1) * 3_600_000 - 15 * 60_000),
      });
    }
    if (i < 3) {
      const start = new Date();
      start.setUTCHours(13 + i * 2, 0, 0, 0);
      await db.insert(schema.appointments).values({
        companyId: cid,
        contactId: c.id,
        procedureId: procs[i % 3].id,
        professionalId: mProf.id,
        roomId: rooms[(i % 2) + 1].id,
        startsAt: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        status: ["confirmed", "scheduled", "waiting"][i],
      });
    }
  }
  await db.insert(schema.goals).values({ companyId: cid, metric: "revenue", target: 5000000, startsOn: "2026-01-01" });
  console.log("Clínica Demo criada (admin@demo.com / vendas@demo.com / carla@demo.com, senha demo12345).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
