import React from 'react';
import { Box, Text } from 'ink';
import gradient from 'gradient-string';

const LOGO_LINES = [
  '##  ##  ##  ##  ##  ##  ######  ##  ##',
  '###  ## ##  ## ###  ##  ##      ###  ##',
  '## # ## ##  ## ## # ##  ######  ## # ##',
  '##  ### ##  ## ##  ###  ##      ##  ###',
  '##   ##  ####  ##   ##  ######  ##   ##',
];

const nuxenGradient = gradient(['#9333EA', '#3B82F6']);

interface HeaderProps {
  taskCount: number;
  eventName: string;
  isRunning: boolean;
}

export const Header: React.FC<HeaderProps> = ({ taskCount, eventName, isRunning }) => (
  <Box flexDirection="column" alignItems="center" paddingY={1}>
    {LOGO_LINES.map((line, i) => (
      <Text key={i}>{nuxenGradient(line)}</Text>
    ))}
    <Box marginTop={1}>
      <Text color="#6B7280">Ticketmaster Bot  |  </Text>
      <Text color="#9333EA" bold>{taskCount} session{taskCount > 1 ? 's' : ''}</Text>
      {eventName ? (
        <>
          <Text color="#6B7280">  |  </Text>
          <Text color="#3B82F6" bold>{eventName}</Text>
        </>
      ) : null}
      {isRunning ? (
        <>
          <Text color="#6B7280">  |  </Text>
          <Text color="#22C55E">[*] actif</Text>
        </>
      ) : null}
    </Box>
    <Box>
      <Text color="#374151">{'------------------------------------------------------------'}</Text>
    </Box>
  </Box>
);
