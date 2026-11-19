import "server-only";
import { todayISO } from "@/lib/utils";

export type TrafegoSearch = {
  aba?: string;
  periodo?: string; // 'hoje' | '7' | '14' | '30' | 'mes' | 'custom'
  de?: string;
  ate?: string;
  conta?: string; // connectionId | undefined (todas)
  campanha?: string; // metaCampaignId | undefined (todas)
  grao?: string; // 'campanha' | 'conjunto' | 'anuncio'
  comparar?: string;
  detalhar?: string; // 'dia' | 'semana' | 'mes'
  ordenar?: string;
};

export const ABAS = [
  ["resumo", "Resumo"],
  ["campanhas", "Campanhas"],
  ["criativos", "Anúncios e criativos"],
  ["whatsapp", "WhatsApp"],
  ["vinculos", "Vínculos"],
  ["alerta", "Alerta de saldo"],
] as const;

/** Converte os filtros de período num intervalo [since, until] em YYYY-MM-DD (fuso local). */
export function resolvePeriod(sp: TrafegoSearch): { since: string; until: string; days: number; label: string } {
  const today = todayISO();
  const daysAgo = (n: number) => todayISO(undefined, new Date(Date.now() - n * 86_400_000));
  switch (sp.periodo) {
    case "hoje":
      return { since: today, until: today, days: 1, label: "Hoje" };
    case "7":
      return { since: daysAgo(6), until: today, days: 7, label: "Últimos 7 dias" };
    case "14":
      return { since: daysAgo(13), until: today, days: 14, label: "Últimos 14 dias" };
    case "mes": {
      const d = new Date();
      const since = todayISO(undefined, new Date(d.getFullYear(), d.getMonth(), 1));
      return { since, until: today, days: 31, label: "Este mês" };
    }
    case "custom":
      if (sp.de && sp.ate) {
        const days = Math.max(1, Math.round((Date.parse(sp.ate) - Date.parse(sp.de)) / 86_400_000) + 1);
        return { since: sp.de, until: sp.ate, days, label: "Personalizado" };
      }
    // fallthrough para o default
    default:
      return { since: daysAgo(29), until: today, days: 30, label: "Últimos 30 dias" };
  }
}

/** Período anterior de mesmo tamanho (para comparação). */
export function previousPeriod(since: string, until: string) {
  const len = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
  const prevUntil = new Date(Date.parse(since) - 86_400_000);
  const prevSince = new Date(prevUntil.getTime() - (len - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(prevSince), until: iso(prevUntil) };
}
