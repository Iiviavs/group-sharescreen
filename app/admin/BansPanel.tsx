"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  fetchBans,
  createBan,
  removeBan,
  BAN_SUBJECT_LABELS,
  type Ban,
  type BanSubject,
} from "@/lib/adminApi";
import { Tooltip } from "@/components/Tooltip";

const POLL_INTERVAL_MS = 5000;

const SUBJECTS: { value: BanSubject; placeholder: string; hint: string }[] = [
  {
    value: "ip",
    placeholder: "Endereço IP",
    hint: "Bloqueia a conexão com o site inteiro — quem estiver conectado cai na hora. É o mais fácil de contornar: um IP é compartilhado por todo mundo atrás do mesmo provedor e muda sozinho em rede móvel.",
  },
  {
    value: "account",
    placeholder: "Id da conta",
    hint: "A conta não consegue mais entrar nem usar um token já emitido. Não impede a pessoa de voltar como convidado ou criar outra conta.",
  },
  {
    value: "fingerprint",
    placeholder: "Fingerprint do navegador",
    hint: "Bloqueia o navegador/aparelho: sobrevive a limpar dados, trocar de conta e mudar de IP. Não é infalível — um cliente modificado pode omitir o valor, e navegadores idênticos podem colidir.",
  },
];

function formatBanTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const SUBJECT_BADGE_CLASS: Record<BanSubject, string> = {
  ip: "bg-red-600 text-white",
  account: "bg-amber-600 text-white",
  fingerprint: "bg-violet-600 text-white",
};

// Identifies a row without relying on the value alone: the same string could
// in principle be banned under two subjects, and React needs them distinct.
function banKey(ban: Ban): string {
  return `${ban.subject}:${ban.value}`;
}

export function BansPanel() {
  const [bans, setBans] = useState<Ban[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const [subject, setSubject] = useState<BanSubject>("ip");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [banning, setBanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchBans();
        if (!cancelled) {
          setBans(data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "unauthorized") return;
        setError("Não foi possível carregar os banimentos.");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleBan(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBanning(true);
    try {
      const minutes = durationMinutes.trim() ? Number(durationMinutes) : undefined;
      const ban = await createBan({
        subject,
        value: value.trim(),
        reason: reason.trim(),
        durationMinutes: minutes,
      });
      setBans((prev) => [ban, ...(prev ?? []).filter((b) => banKey(b) !== banKey(ban))]);
      setValue("");
      setReason("");
      setDurationMinutes("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao banir.");
    } finally {
      setBanning(false);
    }
  }

  async function handleRemove(ban: Ban) {
    setRemovingKey(banKey(ban));
    try {
      await removeBan(ban.subject, ban.value);
      setBans((prev) => (prev ?? []).filter((b) => banKey(b) !== banKey(ban)));
    } catch {
      setError("Falha ao remover o banimento.");
    } finally {
      setRemovingKey(null);
    }
  }

  const activeSubject = SUBJECTS.find((s) => s.value === subject)!;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Banimentos</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Um banimento vale na hora: quem já estiver conectado é desconectado imediatamente. Também
        dá para banir direto da aba Moderação, na linha de cada pessoa.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUBJECTS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSubject(s.value)}
            aria-pressed={subject === s.value}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              subject === s.value
                ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {BAN_SUBJECT_LABELS[s.value]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{activeSubject.hint}</p>

      <form onSubmit={handleBan} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1.6fr_0.8fr_auto]">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={activeSubject.placeholder}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <Tooltip content="Duração em minutos — deixe vazio para um banimento permanente">
          <input
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            type="number"
            min={1}
            placeholder="Minutos (vazio = permanente)"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </Tooltip>
        <button
          type="submit"
          disabled={banning || !value.trim()}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {banning ? "Banindo..." : "Banir"}
        </button>
      </form>
      {formError && <p className="mt-1 text-sm text-red-500">{formError}</p>}

      <div className="mt-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && bans === null && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
        )}
        {!error && bans !== null && bans.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum banimento no momento.</p>
        )}
        <ul className="flex flex-col gap-2">
          {(bans ?? []).map((ban) => (
            <li
              key={banKey(ban)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      SUBJECT_BADGE_CLASS[ban.subject]
                    }`}
                  >
                    {BAN_SUBJECT_LABELS[ban.subject]}
                  </span>
                  <span className="truncate font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {ban.value}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {ban.reason || "Sem motivo informado"} · banido em {formatBanTime(ban.createdAt)}
                  {ban.expiresAt ? ` · expira em ${formatBanTime(ban.expiresAt)}` : " · permanente"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(ban)}
                disabled={removingKey === banKey(ban)}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {removingKey === banKey(ban) ? "Removendo..." : "Remover banimento"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
