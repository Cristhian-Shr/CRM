import type { Ctx } from "@/lib/auth";

export type Action =
  | "team.manage"
  | "settings.manage"
  | "catalog.manage"
  | "integrations.manage"
  | "leads.viewAll"
  | "leads.delete"
  | "discount.overLimit"
  | "reports.viewAll"
  | "campaigns.view"
  | "export.csv";

const ADMIN_ONLY: Action[] = [
  "team.manage",
  "settings.manage",
  "catalog.manage",
  "integrations.manage",
  "leads.delete",
  "discount.overLimit",
  "reports.viewAll",
  "campaigns.view",
  "export.csv",
];

export function can(ctx: Ctx, action: Action): boolean {
  if (ctx.isMaster || ctx.role === "admin") return true;
  if (action === "leads.viewAll") return !!ctx.settings.collaboratorsSeeAllLeads;
  return !ADMIN_ONLY.includes(action);
}

export function assertCan(ctx: Ctx, action: Action) {
  if (!can(ctx, action)) throw new Error("Você não tem permissão para esta ação.");
}
