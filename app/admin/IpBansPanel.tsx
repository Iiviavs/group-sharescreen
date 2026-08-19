"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchBans, banIp, unbanIp, type IpBan } from "@/lib/adminApi";

const POLL_INTERVAL_MS = 5000;

function formatBanTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function IpBansPanel() {
  const [bans, setBans] = useState<IpBan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unbanningIp, setUnbanningIp] = useState<string | null>(null);

  const [ip, setIp] = useState("");
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
        setError("Não foi possível carregar os IPs banidos.");
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
      const ban = await banIp({ ip: ip.trim(), reason: reason.trim(), durationMinutes: minutes });
      setBans((prev) => [ban, ...(prev ?? []).filter((b) => b.ip !== ban.ip)]);
      setIp("");
      setReason("");
      setDurationMinutes("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao banir IP.");
    } finally {
      setBanning(false);
    }
  }

  async function handleUnban(targetIp: string) {
    setUnbanningIp(targetIp);
    try {
      await unbanIp(targetIp);
      setBans((prev) => (prev ?? []).filter((b) => b.ip !== targetIp));
    } catch {
      setError("Falha ao remover o banimento.");
    } finally {
      setUnbanningIp(null);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">IPs banidos</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Um IP banido não consegue abrir conexão com o site (conta e chat inclusos) — quem já
        estiver conectado é desconectado na hora.
      </p>

      <form onSubmit={handleBan} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1.6fr_0.8fr_auto]">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="Endereço IP"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <input
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
          type="number"
          min={1}
          placeholder="Minutos (vazio = permanente)"
          title="Duração em minutos — deixe vazio para um banimento permanente"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={banning || !ip.trim()}
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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum IP banido no momento.</p>
        )}
        <ul className="flex flex-col gap-2">
          {(bans ?? []).map((ban) => (
            <li
              key={ban.ip}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div className="min-w-0">
                <p className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{ban.ip}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {ban.reason || "Sem motivo informado"} · banido em {formatBanTime(ban.createdAt)}
                  {ban.expiresAt ? ` · expira em ${formatBanTime(ban.expiresAt)}` : " · permanente"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleUnban(ban.ip)}
                disabled={unbanningIp === ban.ip}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {unbanningIp === ban.ip ? "Removendo..." : "Remover banimento"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
