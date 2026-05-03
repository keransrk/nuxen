import { store } from './store.js';
import { runTask, type StopSignal } from './task.js';
import { resolveEventUrl } from './eventResolver.js';
import { loadProxyFile, type ProxyEntry } from '../config/proxyFile.js';
import type { AppConfig } from '../config/loader.js';
import type { TaskRow } from '../config/taskCsv.js';

const stopSignals: Map<number, StopSignal> = new Map();

// Contexte d'une tache lancee : row CSV + proxy + eventInfo resolu
export interface TaskContext {
  taskId: number;
  row: TaskRow;
  proxy: ProxyEntry;
  eventInfo: ReturnType<typeof resolveEventUrl>;
}

const pickedRows: TaskRow[] = [];

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

  for (const row of rows) {
    // Resolution event
    let eventInfo: ReturnType<typeof resolveEventUrl>;
    try { eventInfo = resolveEventUrl(row.url); }
    catch (e: any) {
      errors.push(`Row ${row.rowIndex}: URL invalide — ${e.message}`);
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

    // 1 tache par proxy pour ce row
    for (const proxy of proxies) {
      contexts.push({ taskId: nextId++, row, proxy, eventInfo });
    }
  }

  if (contexts.length === 0) {
    return { errors };
  }

  // Affichage global : 1er event si tous identiques, sinon "multi"
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
    proxyLabel: c.proxy.label,
    proxyUrl: c.proxy.url,
    rowIndex: c.row.rowIndex,
    eventLabel: c.eventInfo.slug,
    mode: c.row.mode,
  })));

  store.setRunning(true);

  // Lancement parallele
  for (const ctx of contexts) {
    const signal: StopSignal = { stopped: false };
    stopSignals.set(ctx.taskId, signal);
    runTask(ctx.taskId, ctx.proxy.url, ctx.eventInfo, config, signal, ctx.row).catch(() => {});
  }

  return { errors };
};

export const stopAll = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  for (const task of store.state.tasks) {
    if (!['success', 'error', 'stopped'].includes(task.status)) {
      store.updateTask(task.id, { status: 'stopped', statusText: 'Arrêté', completedAt: new Date() });
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

  // Pour chaque task en erreur, on relance avec son row + proxy d'origine
  for (const task of errorTasks) {
    const row = pickedRows.find(r => r.rowIndex === task.rowIndex);
    if (!row) continue;

    let eventInfo: ReturnType<typeof resolveEventUrl>;
    try { eventInfo = resolveEventUrl(row.url); }
    catch { continue; }

    store.updateTask(task.id, {
      status: 'idle',
      statusText: 'Reprise...',
      logs: [],
      startedAt: new Date(),
      completedAt: undefined,
      error: undefined,
      queuePosition: '',
      forecastStatus: '',
    });

    const signal: StopSignal = { stopped: false };
    stopSignals.set(task.id, signal);
    runTask(task.id, task.proxyUrl, eventInfo, config, signal, row).catch(() => {});
  }

  store.setRunning(true);
};

export const changeTaskFile = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  stopSignals.clear();
  pickedRows.length = 0;
  store.reset();
};
