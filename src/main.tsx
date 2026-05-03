import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { App } from './ui/App.js';
import { UpdateScreen } from './ui/UpdateScreen.js';
import { loadConfig, validateConfig, PATHS } from './config/loader.js';
import { checkForUpdate, downloadAndApplyUpdate, type UpdateCheckResult } from './core/updater.js';
import { APP_VERSION } from './version.js';

process.title = 'NUXEN';

// ─── Load configuration ────────────────────────────────────────────────────────
let _config: ReturnType<typeof loadConfig>['config'];
let _firstRun = false;
let _loadError: string | null = null;

try {
  const result = loadConfig();
  _config = result.config;
  _firstRun = result.firstRun;
} catch (e: any) {
  _loadError = e?.message ?? String(e);
  _config = {} as any;
}

const configErrors = _loadError ? [] : validateConfig(_config!);

// ─── Screen shown when something prevents startup (waits for keypress) ─────────
const ExitScreen: React.FC<{ lines: string[]; isError?: boolean }> = ({ lines, isError }) => {
  const { exit } = useApp();
  useInput(() => exit());
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      {lines.map((l, i) => (
        <Text key={i} color={isError ? 'red' : 'yellow'}>{l}</Text>
      ))}
      <Text color="#6B7280">Appuie sur n'importe quelle touche pour quitter.</Text>
    </Box>
  );
};

// ─── Root component with update check ─────────────────────────────────────────
const Root: React.FC = () => {
  const [updateState, setUpdateState] = useState<
    | { phase: 'checking' }
    | { phase: 'update'; result: UpdateCheckResult }
    | { phase: 'ready' }
  >({ phase: 'checking' });

  useEffect(() => {
    if (_loadError || _firstRun) {
      setUpdateState({ phase: 'ready' });
      return;
    }
    checkForUpdate()
      .then(result => {
        if (result.hasUpdate && result.remoteVersion) {
          setUpdateState({ phase: 'update', result });
        } else {
          setUpdateState({ phase: 'ready' });
        }
      })
      .catch(() => {
        setUpdateState({ phase: 'ready' });
      });
  }, []);

  if (updateState.phase === 'checking') {
    return (
      <Box padding={1} gap={1}>
        <Text color="#6B7280">⟳</Text>
        <Text color="#4B5563">Vérification des mises à jour</Text>
        <Text color="#374151">(v{APP_VERSION})</Text>
      </Box>
    );
  }

  if (updateState.phase === 'update') {
    return (
      <UpdateScreen
        result={updateState.result}
        onDownload={(onProgress) =>
          downloadAndApplyUpdate(updateState.result, onProgress)
        }
        onSkip={() => setUpdateState({ phase: 'ready' })}
      />
    );
  }

  if (_loadError) {
    return <ExitScreen lines={[`Erreur chargement config: ${_loadError}`]} isError />;
  }

  if (_firstRun) {
    return (
      <ExitScreen lines={[
        'Bienvenue sur NUXEN!',
        '',
        'Les fichiers de configuration ont été créés:',
        `  • ${PATHS.configJson}`,
        `  • ${PATHS.proxiesDir}\\proxies.txt`,
        `  • ${PATHS.ticketmasterDir}\\example.csv`,
        '',
        '1. Édite config.json (clé Capsolver + webhook par défaut)',
        '2. Édite Proxies/proxies.txt (tes proxies, un par ligne)',
        '3. Édite TicketMaster/example.csv ou crée tes propres CSV',
        '4. Relance NUXEN.exe',
      ]} />
    );
  }

  return <App config={_config!} configErrors={configErrors} />;
};

// ─── Render TUI ────────────────────────────────────────────────────────────────
render(<Root />, { exitOnCtrlC: true, patchConsole: false });
