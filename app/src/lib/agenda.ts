export const STATUS_LABEL: Record<string, string> = {
  scheduled: "Marcado",
  confirmed: "Confirmado",
  waiting: "Aguardando",
  in_progress: "Em andamento",
  done: "Atendido",
  no_show: "Faltou",
  cancelled: "Desmarcado",
};

export const STATUS_COLOR: Record<string, string> = {
  scheduled: "#3b82f6",
  confirmed: "#1e3a8a",
  waiting: "#eab308",
  in_progress: "#a855f7",
  done: "#16a34a",
  no_show: "#991b1b",
  cancelled: "#d946ef",
};

export const APPOINTMENT_TYPES: Record<string, string> = {
  evaluation: "Avaliação",
  procedure: "Procedimento",
  return: "Retorno",
};

/** Dias da semana (índice = getDay(): 0=Dom … 6=Sáb). */
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export type RoomHours = Record<string, { open: string; close: string }>;

/** Converte "HH:MM" em minutos desde a meia-noite. */
export function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Janela de funcionamento de uma sala num dia da semana.
 * - `undefined` (hours nulo): sem restrição → usa a janela padrão da agenda.
 * - `null`: fechada nesse dia.
 * - `{ startMin, endMin }`: aberta nesse intervalo.
 */
export function roomWindowFor(hours: RoomHours | null | undefined, weekday: number): { startMin: number; endMin: number } | null | undefined {
  if (!hours) return undefined;
  const day = hours[String(weekday)];
  if (!day) return null;
  const startMin = hmToMinutes(day.open);
  const endMin = hmToMinutes(day.close);
  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}
