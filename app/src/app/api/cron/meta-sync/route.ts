import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { syncMetaConnection } from "@/lib/integrations/meta";
import { cronAuthorized } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Roda a cada 3 horas: atualiza campanhas e números de todas as contas conectadas. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("unauthorized", { status: 401 });
  const conns = await db
    .select({ conn: schema.metaConnections })
    .from(schema.metaConnections)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.metaConnections.companyId))
    .where(eq(schema.companies.status, "active"));
  const results: Record<string, unknown> = {};
  for (const { conn } of conns) {
    try {
      results[conn.adAccountId] = await syncMetaConnection(conn);
    } catch (e) {
      results[conn.adAccountId] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json(results);
}
