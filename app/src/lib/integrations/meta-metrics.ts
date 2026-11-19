import "server-only";

/** Tipos de action da Meta usados nas métricas. */
export const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
export const MSG_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

export type MetaAction = { action_type: string; value: string };

/** Soma actions de tipos que podem se sobrepor: usa o MAIOR valor entre os tipos. */
export function maxAction(actions: MetaAction[] | undefined, types: string[]) {
  return Math.round((actions ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => Math.max(s, Number(a.value)), 0));
}

/** Soma simples de UM tipo de action (0 se ausente). */
export function oneAction(actions: MetaAction[] | undefined, type: string) {
  const a = (actions ?? []).find((x) => x.action_type === type);
  return a ? Math.round(Number(a.value)) : 0;
}

/** Mapeia o array `actions` nos campos de engajamento da nossa tabela. */
export function mapEngagement(actions: MetaAction[] | undefined) {
  return {
    leads: maxAction(actions, LEAD_ACTIONS),
    messagesStarted: maxAction(actions, MSG_ACTIONS),
    linkClicks: oneAction(actions, "link_click"),
    reactions: oneAction(actions, "post_reaction"),
    comments: oneAction(actions, "comment"),
    shares: oneAction(actions, "post"),
    saves: oneAction(actions, "onsite_conversion.post_save"),
    videoViews: oneAction(actions, "video_view"),
    postEngagement: oneAction(actions, "post_engagement"),
  };
}

/** Derivadas a partir de agregados (cents de gasto, inteiros de impressão/clique/lead). */
export function ctr(clicks: number, impressions: number) {
  return impressions ? clicks / impressions : 0;
}
export function cpmCents(spendCents: number, impressions: number) {
  return impressions ? Math.round((spendCents / impressions) * 1000) : 0;
}
export function cplCents(spendCents: number, leads: number) {
  return leads ? Math.round(spendCents / leads) : 0;
}
