import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { App } from './ui/App.js';
import { UpdateScreen } from './ui/UpdateScreen.js';
import { loadConfig, validateConfig } from './config/loader.js';
import { checkForUpdate, downloadAndApplyUpdate, type UpdateCheckResult } from './core/updater.js';
import { APP_VERSION } from './version.js';

process.title = 'NUXEN';

// ─── Load configuration ────────────────────────────────────────────────────────
let _config: ReturnType<typeof loadConfig>['config'];
let _proxies: ReturnType<typeof loadConfig>['proxies'];
let _configCreated = false;
let _loadError: string | null = null;

try {
  const result = loadConfig();
  _config = result.config;
  _proxies = result.proxies;
  _configCreated = result.created;
} catch (e: any) {
  _loadError = e?.message ?? String(e);
  _config = {} as any;
  _proxies = [];
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
    // Si erreur de config ou config vide, pas besoin de vérifier les MAJ
    if (_loadError || _configCreated || _proxies.length === 0) {
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

  // Erreur de chargement de config
  if (_loadError) {
    return <ExitScreen lines={[`Erreur chargement config: ${_loadError}`]} isError />;
  }

  // Config créée pour la première fois — fenêtre ne se ferme plus immédiatement
  if (_configCreated) {
    return (
      <ExitScreen lines={[
        'Fichiers de configuration créés dans le dossier du bot.',
        'Édite config/config.csv (clé Capsolver, webhook Discord)',
        'et config/proxies.csv (tes proxies PacketStream)',
        'puis relance NUXEN.',
      ]} />
    );
  }

  // Aucun proxy configuré
  if (_proxies.length === 0) {
    return (
      <ExitScreen
        lines={['Aucun proxy dans config/proxies.csv', 'Ajoute tes proxies puis relance.']}
        isError
      />
    );
  }

  return (
    <App config={_config!} proxies={_proxies} configErrors={configErrors} />
  );
};

// ─── Render TUI ────────────────────────────────────────────────────────────────
render(<Root />, { exitOnCtrlC: true, patchConsole: false });
