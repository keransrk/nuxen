import React from 'react';
import { Box, Text } from 'ink';
import type { TaskState, LogLevel } from '../core/store.js';
import { statusColor, statusIcon } from './theme.js';

interface TaskRowProps {
  task: TaskState;
  focused: boolean;
}

const elapsed = (startedAt: Date, completedAt?: Date): string => {
  const ms = (completedAt ?? new Date()).getTime() - startedAt.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
};

const tsLabel = (ts: number): string => {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const LOG_COLORS: Record<LogLevel, string> = {
  step:    '#818CF8', // indigo — étapes en cours
  success: '#22C55E', // vert   — succès
  error:   '#EF4444', // rouge  — erreurs
  warn:    '#F59E0B', // orange — avertissements
  queue:   '#38BDF8', // bleu   — queue-it
  info:    '#6B7280', // gris   — infos
};

const LOG_ICONS: Record<LogLevel, string> = {
  step:    '→',
  success: '✓',
  error:   '✗',
  warn:    '⚠',
  queue:   '⏳',
  info:    '·',
};

export const TaskRow: React.FC<TaskRowProps> = ({ task, focused }) => {
  const icon = statusIcon(task.status);
  const color = statusColor(task.status);

  // Number of log lines to show: more when focused
  const visibleLogs = focused ? task.logs.slice(-12) : task.logs.slice(-5);

  // Header border color
  const borderColor = focused ? '#9333EA' : '#1F2937';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* ── Header line ────────────────────────────────────────────── */}
      <Box>
        <Text color={focused ? '#9333EA' : '#4B5563'}>
          {focused ? '▶ ' : '  '}
        </Text>
        <Text color="#6B7280" bold>{String(task.id + 1).padStart(2, '0')} </Text>
        <Text color="#374151">[</Text>
        <Text color="#7C3AED">{task.proxyLabel}</Text>
        <Text color="#374151">] </Text>
        <Text>{color(`${icon}`)}</Text>
        <Text color="#D1D5DB"> {task.statusText.slice(0, 50)}</Text>
        {task.status === 'queued' && task.queuePosition ? (
          <Text color="#38BDF8"> ·  {task.queuePosition} devant</Text>
        ) : null}
        {task.status === 'success' && task.basketId ? (
          <Text color="#22C55E"> · #{task.basketId} · {task.price}€</Text>
        ) : null}
        <Text color="#374151"> {elapsed(task.startedAt, task.completedAt)}</Text>
      </Box>

      {/* ── Log lines (always visible) ──────────────────────────────── */}
      {visibleLogs.map((entry, i) => (
        <Box key={i}>
          <Text color={borderColor}>  │ </Text>
          <Text color="#374151">{tsLabel(entry.ts)} </Text>
          <Text color={LOG_COLORS[entry.level]}>
            {LOG_ICONS[entry.level]} {entry.msg}
          </Text>
        </Box>
      ))}

      {/* If there are hidden logs, show count */}
      {!focused && task.logs.length > 5 && (
        <Box>
          <Text color="#374151">  │ </Text>
          <Text color="#4B5563" dimColor>  +{task.logs.length - 5} lignes cachées — [F] pour voir</Text>
        </Box>
      )}
    </Box>
  );
};
