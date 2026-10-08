import { CalendarDays, Receipt, Target, TrendingUp } from "lucide-react";
import { Field, Form, Submit } from "@/components/form";
import { PasswordField } from "@/components/password-field";
import { ThemeToggle } from "@/components/theme-toggle";
import { login } from "@/server/actions/auth";

export const metadata = { title: "Entrar" };

const FEATURES = [
  { icon: TrendingUp, label: "Funil de vendas" },
  { icon: CalendarDays, label: "Agenda" },
  { icon: Receipt, label: "Financeiro" },
  { icon: Target, label: "Metas" },
];

export default function LoginPage() {
  const year = new Date().getFullYear();
  return (
    <main className="relative min-h-screen lg:grid lg:grid-cols-2">
      <ThemeToggle className="btn-ghost absolute top-4 right-4 z-20" />

      {/* Esquerda — formulário */}
      <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-500 font-display text-xl font-bold text-white">
              C
            </div>
            <div>
              <div className="font-display text-xl font-semibold leading-tight">CRM - EstéticaPRO</div>
              <div className="text-xs text-muted">Gestão para clínicas</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-muted">Acesse o painel da sua clínica.</p>

          <Form action={login} resetOnSuccess={false} className="mt-6">
            <Field label="E-mail">
              <input name="email" type="email" required autoComplete="email" className="input" placeholder="nome@email.com" />
            </Field>
            <Field label="Senha">
              <PasswordField name="password" required />
            </Field>
            <Submit className="btn-primary w-full">Entrar</Submit>
          </Form>

          <p className="mt-4 text-sm text-muted">
            Esqueceu a senha? <span className="font-medium text-brand-500">Fale com o administrador da clínica.</span>
          </p>

          <p className="mt-12 text-xs text-muted">© {year} CRM - EstéticaPRO</p>
        </div>
      </div>

      {/* Direita — showcase da marca */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-[#2a1150] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* brilhos decorativos */}
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/4 size-72 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10">
          <h2 className="font-display text-3xl leading-tight font-bold xl:text-4xl">
            Tudo da sua clínica
            <br />
            em um só lugar.
          </h2>
          <p className="mt-3 max-w-md text-white/70">
            Do primeiro contato à venda fechada — leads, agenda, orçamentos, financeiro e metas num painel só.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur">
                <Icon className="size-4" /> {label}
              </span>
            ))}
          </div>
        </div>

        {/* Mock decorativo de dashboard */}
        <div className="relative z-10 mt-10 grid max-w-xl gap-4 rounded-2xl bg-white/5 p-5 backdrop-blur">
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: "Faturamento", v: "R$ 48.2k" },
              { k: "Agendamentos", v: "126" },
              { k: "Conversão", v: "32%" },
            ].map((c) => (
              <div key={c.k} className="rounded-xl bg-white/10 p-3">
                <div className="text-[11px] text-white/60">{c.k}</div>
                <div className="font-display text-lg font-bold">{c.v}</div>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 rounded-xl bg-white/10 p-4">
            {[40, 65, 50, 80, 55, 90, 70].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-white/70" style={{ height: `${h}px` }} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
