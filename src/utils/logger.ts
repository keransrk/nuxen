import { EventEmitter } from 'events';

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'queue' | 'debug';

export interface LogEntry {
  taskId: number;
  level: LogLevel;
  message: string;
  timestamp: Date;
}

class AppLogger extends EventEmitter {
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 500;

  log(taskId: number, level: LogLevel, message: string) {
    const entry: LogEntry = { taskId, level, message, timestamp: new Date() };
    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) this.logs.shift();
    this.emit('log', entry);
  }

  info(taskId: number, msg: string) { this.log(taskId, 'info', msg); }
  success(taskId: number, msg: string) { this.log(taskId, 'success', msg); }
  warn(taskId: number, msg: string) { this.log(taskId, 'warn', msg); }
  error(taskId: number, msg: string) { this.log(taskId, 'error', msg); }
  queue(taskId: number, msg: string) { this.log(taskId, 'queue', msg); }

  getLogsForTask(taskId: number, limit = 20): LogEntry[] {
    return this.logs.filter(l => l.taskId === taskId).slice(-limit);
  }

  getAllLogs(limit = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }
}

export const logger = new AppLogger();
