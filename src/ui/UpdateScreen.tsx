import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { APP_VERSION } from '../version.js';
import type { UpdateCheckResult } from '../core/updater.js';

interface UpdateScreenProps {
  result: UpdateCheckResult;
  onDownload: (onProgress: (msg: string) => void) => Promise<void>;
  onSkip: () => void;
}

export const UpdateScreen: React.FC<UpdateScreenProps> = ({ result, onDownload, onSkip }) => {
  const [progress, setProgress] = useState('Connexion...');
  const [error, setError] = useState('');

  useEffect(() => {
    onDownload((msg) => setProgress(msg)).catch((e) => {
      setError(e.message);
      setTimeout(() => onSkip(), 3000);
    });
  }, []);

  return (
    <Box flexDirection="column" padding={2} gap={1}>
      <Text bold color="#7C3AED">NUXEN ÔÇö Mise ├á jour</Text>

      <Box gap={2}>
        <Text color="#6B7280">Version actuelle :</Text>
        <Text color="#EF4444">v{APP_VERSION}</Text>
        <Text color="#6B7280">ÔåÆ</Text>
        <Text color="#22C55E" bold>v{result.remoteVersion}</Text>
      </Box>

      {result.assetName && (
        <Box gap={2}>
          <Text color="#6B7280">Fichier :</Text>
          <Text color="#D1D5DB">{result.assetName}</Text>
        </Box>
      )}

      {!error ? (
        <Box marginTop={1} gap={1}>
          <Text color="#38BDF8">Ôƒ│</Text>
          <Text color="#D1D5DB">{progress}</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color="#EF4444">ÔÜá {error}</Text>
          <Text color="#6B7280">Lancement sans mise ├á jour dans 3s...</Text>
        </Box>
      )}
    </Box>
  );
};
