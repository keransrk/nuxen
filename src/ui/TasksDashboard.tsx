import React from 'react';
import { Box, Text } from 'ink';
import type { TaskState, LogEntry, LogLevel } from '../core/store.js';
import { statusColor, statusIcon } from './theme.js';

const LOG_COLORS: Record<LogLevel, string> = {
  step:    '#818CF8',
  success: '#22C55E',
  error:   '#EF4444',
  warn:    '#F59E0B',
  queue:   '#38BDF8',
  info:    '#6B7280',
};

const LOG_ICONS: Record<LogLevel, string> = {
  step:    'ÔåÆ',
  success: 'Ô£ô',
  error:   'Ô£ù',
  warn:    'ÔÜá',
  queue:   'ÔÅ│',
  info:    '┬À',
};

const tsLabel = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

interface FlatLogEntry {
  taskId: number;
  taskLabel: string;
  entry: LogEntry;
}

interface TasksDashboardProps {
  tasks: TaskState[];
  scrollOffset: number;
  maxVisible?: number;
}

export const TasksDashboard: React.FC<TasksDashboardProps> = ({
  tasks,
  scrollOffset,
  maxVisible = 40,
}) => {
  if (tasks.length === 0) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Text color="#6B7280">Aucune session. Remplissez config/proxies.csv</Text>
      </Box>
    );
  }

  // ÔöÇÔöÇ Compact task status bar (une ligne par task) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const statusBar = (
    <Box flexDirection="row" flexWrap="wrap" paddingLeft={1} marginBottom={1}>
      {tasks.map(t => {
        const icon = statusIcon(t.status);
        const col = statusColor(t.status);
        return (
          <Box key={t.id} marginRight={2}>
            <Text color="#4B5563">[</Text>
            <Text color="#7C3AED" bold>{String(t.id + 1).padStart(2, '0')}</Text>
            <Text color="#4B5563">┬À</Text>
            <Text color="#6B7280">{t.proxyLabel}</Text>
            <Text color="#4B5563">] </Text>
            <Text>{col(icon)}</Text>
            {t.status === 'queued' && t.queuePosition ? (
              <Text color="#38BDF8"> {t.queuePosition}</Text>
            ) : null}
            {t.status === 'success' && t.basketId ? (
              <Text color="#22C55E"> #{t.basketId}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );

  // ÔöÇÔöÇ Merge all logs chronologically ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const allLogs: FlatLogEntry[] = [];
  for (const task of tasks) {
    for (const entry of task.logs) {
      allLogs.push({
        taskId: task.id,
        taskLabel: String(task.id + 1).padStart(2, '0'),
        entry,
      });
    }
  }
  allLogs.sort((a, b) => a.entry.ts - b.entry.ts);

  // Paginate
  const totalLines = allLogs.length;
  const visible = allLogs.slice(scrollOffset, scrollOffset + maxVisible);
  const hiddenAbove = scrollOffset;
  const hiddenBelow = Math.max(0, totalLines - scrollOffset - maxVisible);

  return (
    <Box flexDirection="column">
      {statusBar}

      <Box borderStyle="single" borderColor="#1F2937" flexDirection="column" paddingX={1}>
        {hiddenAbove > 0 && (
          <Text color="#4B5563" dimColor>  Ôåæ {hiddenAbove} ligne{hiddenAbove > 1 ? 's' : ''} au-dessus</Text>
        )}

        {visible.length === 0 && (
          <Text color="#4B5563">En attente des premi├¿res ├®tapes...</Text>
        )}

        {visible.map((item, i) => (
          <Box key={`${item.taskId}-${item.entry.ts}-${i}`}>
            {/* Task ID badge */}
            <Text color="#4B5563">[</Text>
            <Text color="#9333EA" bold>{item.taskLabel}</Text>
            <Text color="#4B5563">] </Text>
            {/* Timestamp */}
            <Text color="#374151">{tsLabel(item.entry.ts)} </Text>
            {/* Icon + message */}
            <Text color={LOG_COLORS[item.entry.level]}>
              {LOG_ICONS[item.entry.level]} {item.entry.msg}
            </Text>
          </Box>
        ))}

        {hiddenBelow > 0 && (
          <Text color="#4B5563" dimColor>  Ôåô {hiddenBelow} ligne{hiddenBelow > 1 ? 's' : ''} en-dessous</Text>
        )}
      </Box>
    </Box>
  );
};
