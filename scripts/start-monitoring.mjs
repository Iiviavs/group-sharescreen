#!/usr/bin/env node
// Best-effort sidecar for `npm start`: brings up the Prometheus/Grafana
// stack (docker-compose.monitoring.yml) via the Docker CLI, but only once
// the web app is confirmed reachable — so it never adds to startup time —
// and NEVER lets a failure here disrupt the app. If Docker isn't
// installed, the daemon isn't reachable, or the compose command fails for
// any reason, this just logs it and exits quietly.

import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const WEB_PORT = process.env.PORT || 3000;
const HEALTH_URL = `http://127.0.0.1:${WEB_PORT}/`;
const MAX_WAIT_MS = 5 * 60 * 1000; // give the app up to 5 minutes to come online
const POLL_INTERVAL_MS = 2000;

function log(msg) {
  console.log(`[monitoring] ${msg}`);
}

function execFilePromise(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function waitForWeb() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // not up yet, keep polling
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

async function run() {
  try {
    await execFilePromise("docker", ["--version"]);
  } catch {
    log("Docker não encontrado no PATH — pulando Prometheus/Grafana (isso não afeta o site).");
    return;
  }

  log(`Aguardando o site responder em ${HEALTH_URL} antes de subir o monitoramento...`);
  const online = await waitForWeb();
  if (!online) {
    log(`Site não respondeu depois de ${MAX_WAIT_MS / 1000}s — desistindo do monitoramento por agora.`);
    return;
  }

  log("Site online. Subindo Prometheus/Grafana em segundo plano (docker compose)...");
  try {
    const { stdout, stderr } = await execFilePromise("docker", [
      "compose",
      "-f",
      "docker-compose.monitoring.yml",
      "up",
      "-d",
    ]);
    if (stdout.trim()) log(stdout.trim());
    if (stderr.trim()) log(stderr.trim());
    log("Prometheus/Grafana no ar — Grafana em http://localhost:3002.");
  } catch (err) {
    log(`Não foi possível subir o monitoramento (site continua funcionando normalmente): ${err.message}`);
    if (err.stderr) log(String(err.stderr).trim());
  }
}

run()
  .catch((err) => {
    // Absolute last resort — this script must never throw upward or exit
    // non-zero, since that could look like a real `npm start` failure.
    log(`Erro inesperado ao iniciar monitoramento (ignorado): ${err?.message || err}`);
  })
  .finally(() => {
    process.exitCode = 0;
  });
