import React from 'react';
import { Box, Text } from 'ink';

interface MenuBarProps {
  isRunning: boolean;
  autoRetry: boolean;
}

const Key: React.FC<{ k: string; label: string; color?: string }> = ({ k, label, color = '#9333EA' }) => (
  <Box marginRight={2}>
    <Text bold color={color}>[{k}]</Text>
    <Text color="#9CA3AF"> {label}</Text>
  </Box>
);

export const MenuBar: React.FC<MenuBarProps> = ({ isRunning, autoRetry }) => (
  <Box flexDirection="column">
    <Box><Text color="#1F2937">{'─'.repeat(60)}</Text></Box>
    <Box paddingX={1} flexWrap="wrap">
      <Key k="Q" label="Quitter" color="#EF4444" />
      <Key k="C" label="Changer event" color="#F59E0B" />
      {isRunning
        ? <Key k="S" label="Stop" color="#EF4444" />
        : <Key k="R" label="Restart" color="#22C55E" />
      }
      <Key k="A" label={autoRetry ? 'Auto-retry ON' : 'Auto-retry'} color={autoRetry ? '#22C55E' : '#9333EA'} />
      <Key k="↑↓" label="Scroller logs" />
    </Box>
  </Box>
);
