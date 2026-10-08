import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { fetchLead } from "@/lib/integrations/meta";
import { verifySignature } from "@/lib/integrations/whatsapp";
import { normalizePhone } from "@/lib/utils";
import { upsertInboundLead } from "@/server/intake";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type LeadgenWebhook = {
  entry?: { changes?: { field: string; value: { leadgen_id: string; page_id: string; ad_id?: string; adgroup_id?: string } }[] }[];
};

/** Lead Ads: cada formulário preenchido vira contato em "Novo Lead". */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const body = JSON.parse(raw) as LeadgenWebhook;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen") continue;
      const conn = await db.query.metaConnections.findFirst({ where: eq(schema.metaConnections.pageId, ch.value.page_id) });
      if (!conn) continue;
      try {
        const lead = await fetchLead(ch.value.leadgen_id, decrypt(conn.accessTokenEnc));
        const field = (...names: string[]) => lead.field_data.find((f) => names.includes(f.name))?.values[0] ?? null;
        await upsertInboundLead(conn.companyId, {
          name: field("full_name", "nome", "name", "first_name") ?? "Lead Meta",
          phone: normalizePhone(field("phone_number", "telefone", "whatsapp")),
          email: field("email"),
          sourceName: "Formulário Meta",
          meta: { leadId: lead.id, campaignId: lead.campaign_id, adsetId: lead.adset_id, adId: lead.ad_id },
        });
      } catch (e) {
        console.error("meta-leads", e);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
