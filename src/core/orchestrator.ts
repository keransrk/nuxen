import { store } from './store.js';
import { runTask, type StopSignal } from './task.js';
import { resolveEventUrl } from './eventResolver.js';
import { loadProxyFile, ProxyPool, type ProxyEntry } from '../config/proxyFile.js';
import type { AppConfig } from '../config/loader.js';
import type { TaskRow } from '../config/taskCsv.js';

const stopSignals: Map<number, StopSignal> = new Map();

export interface TaskContext {
  taskId: number;
  row: TaskRow;
  proxyPool: ProxyPool;
  eventInfo: ReturnType<typeof resolveEventUrl>;
}

const pickedRows: TaskRow[] = [];
const storedPools: Map<number, ProxyPool> = new Map();

export const startFromRows = (
  rows: TaskRow[],
  config: AppConfig,
  taskFileName: string
): { errors: string[] } => {
  const errors: string[] = [];
  const contexts: TaskContext[] = [];
  let nextId = 0;

  pickedRows.length = 0;
  pickedRows.push(...rows);
  storedPools.clear();

  for (const row of rows) {
    // Resolution event
    let eventInfo: ReturnType<typeof resolveEventUrl>;
    try { eventInfo = resolveEventUrl(row.url); }
    catch (e: any) {
      errors.push(`Row ${row.rowIndex}: URL invalide - ${e.message}`);
      continue;
    }

    // Chargement proxies
    let proxies: ProxyEntry[];
    try { proxies = loadProxyFile(row.proxyFile); }
    catch (e: any) {
      errors.push(`Row ${row.rowIndex}: ${e.message}`);
      continue;
    }
    if (proxies.length === 0) {
      errors.push(`Row ${row.rowIndex}: aucun proxy dans ${row.proxyFile}`);
      continue;
    }

    // 1 tache par row CSV — le pool contient TOUS les proxies du fichier
    // La tache tourne en boucle et change de proxy si l'un est bloque
    const pool = new ProxyPool(proxies);
    const taskId = nextId++;
    storedPools.set(taskId, pool);

    contexts.push({
      taskId,
      row,
      proxyPool: pool,
      eventInfo,
    });
  }

  if (contexts.length === 0) {
    return { errors };
  }

  // Affichage global
  const firstEvent = contexts[0].eventInfo;
  const allSameEvent = contexts.every(c => c.eventInfo.idmanif === firstEvent.idmanif);
  if (allSameEvent) {
    store.setEvent(firstEvent.url, firstEvent.idmanif, firstEvent.slug);
  } else {
    store.setEvent('', 'multi', 'multi-events');
  }
  store.setTaskFile(taskFileName);

  // Init des tasks dans le store
  store.init(contexts.map(c => ({
    id: c.taskId,
    proxyLabel: c.proxyPool.current.label,
    proxyUrl: c.proxyPool.current.url,
    rowIndex: c.row.rowIndex,
    eventLabel: c.eventInfo.slug,
    mode: c.row.mode,
  })));

  store.setRunning(true);

  // Lancement parallele — 1 goroutine par row CSV
  for (const ctx of contexts) {
    const signal: StopSignal = { stopped: false };
    stopSignals.set(ctx.taskId, signal);
    runTask(ctx.taskId, ctx.proxyPool, ctx.eventInfo, config, signal, ctx.row).catch(() => {});
  }

  return { errors };
};

export const stopAll = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  for (const task of store.state.tasks) {
    if (!['success', 'error', 'stopped'].includes(task.status)) {
      store.updateTask(task.id, { status: 'stopped', statusText: 'Arrete', completedAt: new Date() });
    }
  }
  store.setRunning(false);
};

export const restartAll = (config: AppConfig) => {
  stopAll();
  if (pickedRows.length > 0) {
    setTimeout(() => startFromRows([...pickedRows], config, store.state.taskFileName), 500);
  }
};

export const retryErrors = (config: AppConfig) => {
  const errorTasks = store.state.tasks.filter(t => t.status === 'error' || t.status === 'stopped');
  if (errorTasks.length === 0) return;

  for (const task of errorTasks) {
    const row = pickedRows.find(r => r.rowIndex === task.rowIndex);
    if (!row) continue;

    let eventInfo: ReturnType<typeof resolveEventUrl>;
    try { eventInfo = resolveEventUrl(row.url); }
    catch { continue; }

    // Recuperer le pool existant (deja rotate) ou en creer un nouveau
    let pool = storedPools.get(task.id);
    if (!pool) {
      try {
        const proxies = loadProxyFile(row.proxyFile);
        if (proxies.length === 0) continue;
        pool = new ProxyPool(proxies);
        storedPools.set(task.id, pool);
      } catch { continue; }
    }

    store.updateTask(task.id, {
      status: 'idle',
      statusText: 'Reprise...',
      logs: [],
      startedAt: new Date(),
      completedAt: undefined,
      error: undefined,
      queuePosition: '',
      forecastStatus: '',
      proxyLabel: pool.current.label,
      proxyUrl: pool.current.url,
    });

    const signal: StopSignal = { stopped: false };
    stopSignals.set(task.id, signal);
    runTask(task.id, pool, eventInfo, config, signal, row).catch(() => {});
  }

  store.setRunning(true);
};

export const changeTaskFile = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  stopSignals.clear();
  storedPools.clear();
  pickedRows.length = 0;
  store.reset();
};
