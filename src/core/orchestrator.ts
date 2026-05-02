import { store } from './store.js';
import { runTask, type StopSignal } from './task.js';
import { resolveEventUrl } from './eventResolver.js';
import type { ProxyEntry, AppConfig } from '../config/loader.js';

const stopSignals: Map<number, StopSignal> = new Map();

export const startAll = (
  eventUrl: string,
  proxies: ProxyEntry[],
  config: AppConfig
) => {
  const eventInfo = resolveEventUrl(eventUrl);

  store.setEvent(eventInfo.url, eventInfo.idmanif, eventInfo.slug);

  // Initialize task states
  store.init(proxies.map((p, i) => ({
    id: i,
    proxyLabel: p.label,
    proxyUrl: p.url,
  })));

  store.setRunning(true);

  // Spawn all tasks in parallel
  for (const [i, proxy] of proxies.entries()) {
    const signal: StopSignal = { stopped: false };
    stopSignals.set(i, signal);

    runTask(i, proxy.url, eventInfo, config, signal).catch(() => {});
  }
};

export const stopAll = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  // Update all running tasks to stopped
  for (const task of store.state.tasks) {
    if (!['success', 'error', 'stopped'].includes(task.status)) {
      store.updateTask(task.id, { status: 'stopped', statusText: 'Arrêté', completedAt: new Date() });
    }
  }
  store.setRunning(false);
};

export const restartAll = (
  proxies: ProxyEntry[],
  config: AppConfig
) => {
  stopAll();
  const eventUrl = store.state.eventUrl;
  if (eventUrl) {
    setTimeout(() => startAll(eventUrl, proxies, config), 500);
  }
};

export const retryErrors = (
  proxies: ProxyEntry[],
  config: AppConfig
) => {
  const eventInfo = resolveEventUrl(store.state.eventUrl);
  const errorTasks = store.state.tasks.filter(t => t.status === 'error' || t.status === 'stopped');

  for (const task of errorTasks) {
    const proxy = proxies[task.id];
    if (!proxy) continue;

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
    runTask(task.id, proxy.url, eventInfo, config, signal).catch(() => {});
  }

  store.setRunning(true);
};

export const changeEvent = () => {
  for (const signal of stopSignals.values()) {
    signal.stopped = true;
  }
  stopSignals.clear();
  store.reset();
};
