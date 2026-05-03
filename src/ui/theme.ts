import chalk from 'chalk';
import type { TaskStatus } from '../core/store.js';

export const COLORS = {
  violet: '#9333EA',
  blue: '#3B82F6',
  green: '#22C55E',
  red: '#EF4444',
  yellow: '#F59E0B',
  gray: '#6B7280',
  white: '#F9FAFB',
  dark: '#1F2937',
};

export const statusColor = (status: TaskStatus): chalk.Chalk => {
  switch (status) {
    case 'success':  return chalk.hex(COLORS.green);
    case 'error':    return chalk.hex(COLORS.red);
    case 'queued':   return chalk.hex(COLORS.blue);
    case 'stopped':  return chalk.hex(COLORS.gray);
    case 'cookies':
    case 'grille':
    case 'recaptcha':
    case 'purchase': return chalk.hex(COLORS.violet);
    default:         return chalk.hex(COLORS.gray);
  }
};

export const statusIcon = (status: TaskStatus): string => {
  switch (status) {
    case 'idle':     return '[ ]';
    case 'cookies':  return '[~]';
    case 'grille':   return '[~]';
    case 'recaptcha':return '[~]';
    case 'purchase': return '[~]';
    case 'queued':   return '[Q]';
    case 'success':  return '[OK]';
    case 'error':    return '[X]';
    case 'stopped':  return '[S]';
  }
};

export const statusLabel = (status: TaskStatus): string => {
  switch (status) {
    case 'idle':     return 'Attente';
    case 'cookies':  return 'Cookies';
    case 'grille':   return 'Grille';
    case 'recaptcha':return 'reCAPTCHA';
    case 'purchase': return 'Panier';
    case 'queued':   return 'File';
    case 'success':  return 'Succes';
    case 'error':    return 'Erreur';
    case 'stopped':  return 'Arrete';
  }
};

export const violet = chalk.hex(COLORS.violet);
export const blue = chalk.hex(COLORS.blue);
export const green = chalk.hex(COLORS.green);
export const red = chalk.hex(COLORS.red);
export const gray = chalk.hex(COLORS.gray);
export const white = chalk.hex(COLORS.white);
export const dim = chalk.dim;
export const bold = chalk.bold;
