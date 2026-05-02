import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import gradient from 'gradient-string';

const LOGO_LINES = [
  '███╗   ██╗██╗   ██╗██╗  ██╗███████╗███╗   ██╗',
  '████╗  ██║██║   ██║╚██╗██╔╝██╔════╝████╗  ██║',
  '██╔██╗ ██║██║   ██║ ╚███╔╝ █████╗  ██╔██╗ ██║',
  '██║╚██╗██║██║   ██║ ██╔██╗ ██╔══╝  ██║╚██╗██║',
  '██║ ╚████║╚██████╔╝██╔╝ ██╗███████╗██║ ╚████║',
  '╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝',
];

const nuxenGradient = gradient(['#9333EA', '#3B82F6']);

interface EventPromptProps {
  proxyCount: number;
  onSubmit: (url: string) => void;
  error?: string;
}

export const EventPrompt: React.FC<EventPromptProps> = ({ proxyCount, onSubmit, error }) => {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useInput((char, key) => {
    if (submitted) return;

    if (key.return) {
      const url = input.trim();
      if (!url) return;
      setSubmitted(true);
      onSubmit(url);
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && char) {
      setInput(prev => prev + char);
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i}>{nuxenGradient(line)}</Text>
      ))}

      <Box marginTop={2} flexDirection="column" alignItems="center">
        <Text color="#9CA3AF">Ticketmaster France Bot</Text>
        <Text color="#4B5563">{'─'.repeat(50)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" alignItems="flex-start" width={60}>
        <Text color="#6B7280">
          {proxyCount} proxy{proxyCount > 1 ? 's' : ''} chargé{proxyCount > 1 ? 's' : ''}
        </Text>
        <Box marginTop={1}>
          <Text color="#9333EA" bold>URL événement › </Text>
          <Text color="#F9FAFB">{input}</Text>
          {!submitted && <Text color="#9333EA" bold>█</Text>}
        </Box>
        <Text color="#4B5563" dimColor>
          Ex: https://www.ticketmaster.fr/fr/manifestation/gims-billet/idmanif/645637
        </Text>
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="#EF4444">⚠ {error}</Text>
        </Box>
      )}

      {submitted && (
        <Box marginTop={1}>
          <Text color="#9333EA">Démarrage des sessions...</Text>
        </Box>
      )}
    </Box>
  );
};
