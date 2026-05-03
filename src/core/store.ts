import { EventEmitter } from 'events';

export type TaskStatus =
  | 'idle'
  | 'cookies'
  | 'grille'
  | 'recaptcha'
  | 'purchase'
  | 'queued'
  | 'success'
  | 'error'
  | 'stopped';

export type LogLevel = 'step' | 'success' | 'error' | 'warn' | 'queue' | 'info';

export interface LogEntry {
  msg: string;
  level: LogLevel;
  ts: number;
}

export interface TaskState {
  id: number;
  proxyLabel: string;
  proxyUrl: string;
  rowIndex?: number;
  eventLabel?: string;
  mode?: string;
  status: TaskStatus;
  statusText: string;
  queuePosition: string;
  forecastStatus: string;
  basketId?: number;
  price?: number;
  category?: string;
  seats?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  logs: LogEntry[];
}

export interface GlobalStore {
  tasks: TaskState[];
  eventUrl: string;
  idmanif: string;
  slug: string;
  taskFileName: string;
  isRunning: boolean;
}

class Store extends EventEmitter {
  state: GlobalStore = {
    tasks: [],
    eventUrl: '',
    idmanif: '',
    slug: '',
    taskFileName: '',
    isRunning: false,
  };

  init(tasks: Omit<TaskState, 'status' | 'statusText' | 'queuePosition' | 'forecastStatus' | 'logs' | 'startedAt'>[]) {
    this.state.tasks = tasks.map(t => ({
      ...t,
      status: 'idle',
      statusText: 'En attente...',
      queuePosition: '',
      forecastStatus: '',
      logs: [],
      startedAt: new Date(),
    }));
    this.emit('change');
  }

  updateTask(id: number, patch: Partial<TaskState>) {
    const idx = this.state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    this.state.tasks[idx] = { ...this.state.tasks[idx], ...patch };
    this.emit('change');
  }

  appendLog(id: number, msg: string, level: LogLevel = 'info') {
    const idx = this.state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const entry: LogEntry = { msg, level, ts: Date.now() };
    const logs = [...this.state.tasks[idx].logs, entry].slice(-40);
    this.state.tasks[idx] = { ...this.state.tasks[idx], logs };
    this.emit('change');
  }

  setEvent(eventUrl: string, idmanif: string, slug: string) {
    this.state.eventUrl = eventUrl;
    this.state.idmanif = idmanif;
    this.state.slug = slug;
    this.emit('change');
  }

  setTaskFile(name: string) {
    this.state.taskFileName = name;
    this.emit('change');
  }

  setRunning(v: boolean) {
    this.state.isRunning = v;
    this.emit('change');
  }

  reset() {
    this.state = {
      tasks: [],
      eventUrl: '',
      idmanif: '',
      slug: '',
      taskFileName: '',
      isRunning: false,
    };
    this.emit('change');
  }
}

export const store = new Store();
