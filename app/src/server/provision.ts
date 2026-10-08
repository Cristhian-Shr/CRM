import { schema, type Tx } from "@/lib/db";

export const DEFAULT_STAGES = [
  { name: "Novo Lead", color: "#6366f1", kind: "open" },
  { name: "Em Qualificação", color: "#0ea5e9", kind: "open" },
  { name: "Aguardando Proposta", color: "#f59e0b", kind: "open" },
  { name: "Em Negociação", color: "#a855f7", kind: "open" },
  { name: "Fechado / Ganho", color: "#16a34a", kind: "won" },
  { name: "Perdido", color: "#dc2626", kind: "lost" },
] as const;

export const DEFAULT_SOURCES = [
  { name: "Instagram", type: "paid_ad" },
  { name: "Facebook", type: "paid_ad" },
  { name: "WhatsApp", type: "organic" },
  { name: "Indicação", type: "referral" },
  { name: "Site", type: "website" },
  { name: "Passou na porta", type: "other" },
];

export const DEFAULT_LOSS_REASONS = ["Preço", "Sem retorno", "Fechou com concorrente", "Sem interesse", "Outro"];

/** Cria a estrutura padrão de uma clínica nova (etapas, origens, motivos de perda, sala). */
export async function provisionCompany(tx: Tx, companyId: string) {
  await tx.insert(schema.pipelineStages).values(
    DEFAULT_STAGES.map((s, i) => ({ ...s, companyId, position: i + 1 })),
  );
  await tx.insert(schema.leadSources).values(DEFAULT_SOURCES.map((s) => ({ ...s, companyId })));
  await tx.insert(schema.lossReasons).values(DEFAULT_LOSS_REASONS.map((name) => ({ name, companyId })));
  await tx.insert(schema.rooms).values([
    { companyId, name: "Avaliação" },
    { companyId, name: "Estética 1" },
  ]);
}
