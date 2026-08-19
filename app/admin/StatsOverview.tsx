"use client";

import { useEffect, useState } from "react";
import { fetchAdminStats, type AdminStats } from "@/lib/adminApi";

const POLL_INTERVAL_MS = 5000;

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
    </div>
  );
}

export function StatsOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchAdminStats();
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "unauthorized") return;
        setError("Não foi possível carregar as estatísticas.");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!stats) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando estatísticas...</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label="Pessoas online" value={stats.peopleOnline} />
      <StatCard label="Compartilhando tela" value={stats.sharingCount} />
      <StatCard label="Conexões abertas" value={stats.connectedSockets} />
      <StatCard label="Salas públicas" value={stats.publicRooms} />
      <StatCard label="Salas privadas" value={stats.privateRooms} />
      <StatCard label="IPs banidos" value={stats.bannedIps} />
      <StatCard label="Palavras filtradas" value={stats.bannedWords} />
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">MongoDB</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-zinc-950 dark:text-zinc-50">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              !stats.mongo.enabled
                ? "bg-zinc-400"
                : stats.mongo.connected
                  ? "bg-emerald-500"
                  : "bg-red-500"
            }`}
          />
          {!stats.mongo.enabled ? "Não configurado" : stats.mongo.connected ? "Conectado" : "Desconectado"}
        </p>
      </div>
    </div>
  );
}
