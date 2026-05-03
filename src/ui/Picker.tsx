import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import gradient from 'gradient-string';

const LOGO_LINES = [
  '##   ##  ##   ##  ##   ##  ######  ##   ##',
  '###  ##  ##   ##   ## ##   ##      ###  ##',
  '## # ##  ##   ##    ###    #####   ## # ##',
  '##  ###  ##   ##   ## ##   ##      ##  ###',
  '##   ##   #####   ##   ##  ######  ##   ##',
];

const nuxenGradient = gradient(['#9333EA', '#3B82F6']);

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface PickerProps {
  title: string;
  subtitle?: string;
  options: PickerOption[];
  showLogo?: boolean;
  onSelect: (id: string) => void;
  onBack?: () => void;
  error?: string;
  emptyMessage?: string;
}

export const Picker: React.FC<PickerProps> = ({
  title, subtitle, options, showLogo, onSelect, onBack, error, emptyMessage,
}) => {
  const [input, setInput] = useState('');

  useInput((char, key) => {
    if (key.escape && onBack) {
      onBack();
      return;
    }
    if (key.return) {
      const n = parseInt(input, 10);
      if (!isNaN(n) && n >= 1 && n <= options.length) {
        const opt = options[n - 1];
        if (!opt.disabled) onSelect(opt.id);
      }
      setInput('');
      return;
    }
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }
    if (/^[0-9]$/.test(char)) {
      setInput(prev => (prev + char).slice(0, 3));
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      {showLogo && LOGO_LINES.map((line, i) => (
        <Text key={i}>{nuxenGradient(line)}</Text>
      ))}

      <Box marginTop={showLogo ? 2 : 0} flexDirection="column" alignItems="center">
        <Text color="#9CA3AF">{title}</Text>
        {subtitle && <Text color="#6B7280">{subtitle}</Text>}
        <Text color="#4B5563">{'--------------------------------------------------'}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" alignItems="flex-start" width={60}>
        {options.length === 0 ? (
          <Text color="#F87171">{emptyMessage ?? 'Aucune option disponible'}</Text>
        ) : (
          options.map((opt, i) => (
            <Box key={opt.id} gap={1}>
              <Text color={opt.disabled ? '#4B5563' : '#9333EA'} bold>
                [{i + 1}]
              </Text>
              <Text color={opt.disabled ? '#4B5563' : '#F9FAFB'}>{opt.label}</Text>
              {opt.hint && <Text color="#6B7280" dimColor>{opt.hint}</Text>}
            </Box>
          ))
        )}

        {options.length > 0 && (
          <Box marginTop={1}>
            <Text color="#9333EA" bold>{'> '}</Text>
            <Text color="#F9FAFB">{input || '_'}</Text>
          </Box>
        )}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="#EF4444">[!] {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="#4B5563" dimColor>
          {onBack ? '[Esc] Retour | ' : ''}[Entree] Valider | [Q] Quitter
        </Text>
      </Box>
    </Box>
  );
};
