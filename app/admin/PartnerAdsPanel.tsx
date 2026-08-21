"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createPartner,
  deletePartner,
  editPartner,
  fetchAdminPartners,
  setPartnerEmptyPercent,
  type AdminPartner,
  type PartnerInput,
  type PartnerStats,
} from "@/lib/adminApi";

const STATS_POLL_INTERVAL_MS = 3000;

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "mt-1 h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Mode = "closed" | "create" | "edit";

const emptyFormDefaults = {
  title: "",
  description: "",
  imageUrl: "",
  buttonLabel: "",
  buttonUrl: "",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
};

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PartnerAdsPanel() {
  // undefined = still loading.
  const [partners, setPartners] = useState<AdminPartner[] | undefined>(undefined);
  const [stats, setStats] = useState<Record<string, PartnerStats>>({});
  // Wall-clock time as of the last successful load/poll — used for the
  // "Expirado" badge below. Captured here (inside applyList, only ever
  // called from a fetch's `.then()`) rather than calling Date.now() during
  // render, which would make the render itself impure/non-deterministic.
  const [asOf, setAsOf] = useState(0);
  const [emptyPercent, setEmptyPercent] = useState(0);
  const [emptyPercentInput, setEmptyPercentInput] = useState("0");
  const [savingPercent, setSavingPercent] = useState(false);
  const [percentError, setPercentError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyFormDefaults);
  const [weight, setWeight] = useState(1);
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresInput, setExpiresInput] = useState("");
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);

  function applyList(data: { partners: AdminPartner[]; emptyPercent: number; stats: Record<string, PartnerStats> }) {
    if (!mountedRef.current) return;
    setPartners(data.partners);
    setStats(data.stats);
    setEmptyPercent(data.emptyPercent);
    setAsOf(Date.now());
    if (!initialLoadDone.current) {
      setEmptyPercentInput(String(data.emptyPercent));
      initialLoadDone.current = true;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    fetchAdminPartners()
      .then(applyList)
      .catch(() => {
        if (mountedRef.current) setPartners([]);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Polls live engagement numbers — deliberately only refreshes the list/
  // stats/current-percent display, never emptyPercentInput or the create/
  // edit form fields, so it doesn't clobber whatever the admin is mid-typing.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAdminPartners()
        .then(applyList)
        .catch(() => {
          // Transient poll failure — keep showing the last known numbers.
        });
    }, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  function update<K extends keyof typeof emptyFormDefaults>(key: K, value: (typeof emptyFormDefaults)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setMode("closed");
    setEditingId(null);
    setForm(emptyFormDefaults);
    setWeight(1);
    setNeverExpires(true);
    setExpiresInput("");
    setPreviewing(false);
    setError(null);
  }

  function startEditing(p: AdminPartner) {
    setMode("edit");
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl ?? "",
      buttonLabel: p.buttonLabel,
      buttonUrl: p.buttonUrl,
      backgroundColor: p.backgroundColor ?? "#111827",
      textColor: p.textColor ?? "#f4f4f5",
      buttonBackgroundColor: p.buttonBackgroundColor ?? "#10b981",
      buttonTextColor: p.buttonTextColor ?? "#ffffff",
    });
    setWeight(p.weight);
    setNeverExpires(p.expiresAt === null);
    setExpiresInput(p.expiresAt ? toDatetimeLocalValue(p.expiresAt) : "");
    setPreviewing(false);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const input: PartnerInput = {
        title: form.title.trim(),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim() || undefined,
        buttonLabel: form.buttonLabel.trim(),
        buttonUrl: form.buttonUrl.trim(),
        backgroundColor: form.backgroundColor.trim() || undefined,
        textColor: form.textColor.trim() || undefined,
        buttonBackgroundColor: form.buttonBackgroundColor.trim() || undefined,
        buttonTextColor: form.buttonTextColor.trim() || undefined,
        weight,
        expiresAt: neverExpires || !expiresInput ? null : new Date(expiresInput).getTime(),
      };
      if (mode === "edit" && editingId) {
        await editPartner(editingId, input);
      } else {
        await createPartner(input);
      }
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar anúncio.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deletePartner(id);
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      if (editingId === id) resetForm();
    } catch {
      setError("Falha ao remover anúncio.");
    }
  }

  async function handleSavePercent() {
    setPercentError(null);
    const value = Number(emptyPercentInput);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setPercentError("Use um número entre 0 e 100.");
      return;
    }
    setSavingPercent(true);
    try {
      const saved = await setPartnerEmptyPercent(value);
      setEmptyPercent(saved);
      setEmptyPercentInput(String(saved));
    } catch {
      setPercentError("Falha ao salvar a porcentagem.");
    } finally {
      setSavingPercent(false);
    }
  }

  const needsSave = String(emptyPercent) !== emptyPercentInput.trim();

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Anúncios de parceiros</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Gerencia os anúncios exibidos no card lateral das salas. Atualiza ao vivo via socket para quem já
        está com a sala aberta; quem abre/recarrega a página busca via HTTP.
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <label htmlFor="partner-empty-percent" className={labelClass}>
          Porcentagem de requests que retornam vazio (mostra o &quot;anuncie aqui&quot;)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="partner-empty-percent"
            type="number"
            min={0}
            max={100}
            value={emptyPercentInput}
            onChange={(e) => setEmptyPercentInput(e.target.value)}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">%</span>
          <button
            type="button"
            onClick={handleSavePercent}
            disabled={savingPercent || !needsSave}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {savingPercent ? "Salvando..." : "Salvar"}
          </button>
        </div>
        {percentError && <p className="mt-1 text-xs text-red-500">{percentError}</p>}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Só afeta quem abre/recarrega a página (busca via HTTP) — quem já está online nunca recebe vazio
          por causa dessa regra quando um anúncio é criado, editado ou removido.
        </p>
      </div>

      {partners === undefined ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Carregando anúncios...</p>
      ) : partners.length === 0 && mode === "closed" ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Nenhum anúncio cadastrado.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {partners.map((p) => {
            const expired = p.expiresAt !== null && p.expiresAt <= asOf;
            const s = stats[p.id] ?? { views: 0, clicks: 0 };
            // Click-through rate against unique people, not against total
            // impressions: with rotation the same person can be served the
            // same ad several times in one session, and a ratio whose
            // denominator grows every five minutes while nobody new arrives
            // is a number that only ever falls.
            const ctr =
              s.uniqueViews && s.uniqueViews > 0
                ? `${((s.clicks / s.uniqueViews) * 100).toFixed(1)}%`
                : null;
            return (
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  expired
                    ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {p.title}
                  </span>
                  {expired && (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Expirado
                    </span>
                  )}
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">peso {p.weight}</span>
                  <button
                    type="button"
                    onClick={() => startEditing(p)}
                    className="shrink-0 font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    className="shrink-0 font-semibold text-red-600 underline underline-offset-2 dark:text-red-400"
                  >
                    Remover
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
                  <span>Expira: {p.expiresAt ? new Date(p.expiresAt).toLocaleString("pt-BR") : "nunca"}</span>
                  <span>
                    Impressões: <strong>{s.views}</strong>
                  </span>
                  <span>
                    Sessões: <strong>{s.sessionViews ?? "—"}</strong>
                  </span>
                  <span>
                    Pessoas únicas:{" "}
                    <strong>{s.uniqueViews ?? "—"}</strong>
                  </span>
                  <span>
                    Cliques: <strong>{s.clicks}</strong>
                    {ctr ? ` (${ctr})` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "closed" ? (
        <button
          type="button"
          onClick={() => setMode("create")}
          className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          + Novo anúncio
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {mode === "edit" ? "Editando anúncio" : "Novo anúncio"}
          </p>

          <div>
            <label htmlFor="partner-title" className={labelClass}>
              Título
            </label>
            <input
              id="partner-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={80}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-description" className={labelClass}>
              Descrição
            </label>
            <textarea
              id="partner-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={400}
              rows={2}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-image" className={labelClass}>
              URL da imagem (opcional)
            </label>
            <input
              id="partner-image"
              value={form.imageUrl}
              onChange={(e) => update("imageUrl", e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="partner-button-label" className={labelClass}>
                Label do botão
              </label>
              <input
                id="partner-button-label"
                value={form.buttonLabel}
                onChange={(e) => update("buttonLabel", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-button-url" className={labelClass}>
                Link do botão
              </label>
              <input
                id="partner-button-url"
                value={form.buttonUrl}
                onChange={(e) => update("buttonUrl", e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="partner-bg" className={labelClass}>
                Fundo
              </label>
              <input
                id="partner-bg"
                type="color"
                value={form.backgroundColor}
                onChange={(e) => update("backgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-text" className={labelClass}>
                Texto
              </label>
              <input
                id="partner-text"
                type="color"
                value={form.textColor}
                onChange={(e) => update("textColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-bg" className={labelClass}>
                Fundo do botão
              </label>
              <input
                id="partner-btn-bg"
                type="color"
                value={form.buttonBackgroundColor}
                onChange={(e) => update("buttonBackgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-text" className={labelClass}>
                Texto do botão
              </label>
              <input
                id="partner-btn-text"
                type="color"
                value={form.buttonTextColor}
                onChange={(e) => update("buttonTextColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div>
              <label htmlFor="partner-weight" className={labelClass}>
                Peso (distribuição entre anúncios ativos)
              </label>
              <input
                id="partner-weight"
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                1 = mesma chance que os outros, 2 = o dobro, etc.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={(e) => setNeverExpires(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Nunca expira
            </label>
          </div>

          {!neverExpires && (
            <div>
              <label htmlFor="partner-expires" className={labelClass}>
                Expira em
              </label>
              <input
                id="partner-expires"
                type="datetime-local"
                value={expiresInput}
                onChange={(e) => setExpiresInput(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPreviewing((p) => !p)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {previewing ? "Ocultar preview" : "Preview"}
            </button>
            <button
              type="submit"
              disabled={sending || !form.title.trim() || !form.buttonLabel.trim() || !form.buttonUrl.trim()}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {sending ? "Salvando..." : mode === "edit" ? "Salvar edição" : "Criar anúncio"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Cancelar
            </button>
          </div>

          {previewing && (
            <div
              className="w-72 max-w-full overflow-hidden rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
            >
              <div className="mb-2 flex items-center">
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
                  Patrocinado
                </span>
              </div>
              {form.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
              )}
              <p className="text-sm font-semibold">{form.title || "Título do anúncio"}</p>
              <p className="mt-1 whitespace-pre-line text-xs opacity-80">
                {form.description || "Descrição do anúncio"}
              </p>
              <div
                className="mt-3 rounded-lg px-3 py-2 text-center text-sm font-semibold"
                style={{ backgroundColor: form.buttonBackgroundColor, color: form.buttonTextColor }}
              >
                {form.buttonLabel || "Botão"}
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
