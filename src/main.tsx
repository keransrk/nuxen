import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import gradient from 'gradient-string';
import { App } from './ui/App.js';
import { UpdateScreen } from './ui/UpdateScreen.js';
import { loadConfig, validateConfig, PATHS } from './config/loader.js';
import { checkForUpdate, downloadAndApplyUpdate, type UpdateCheckResult } from './core/updater.js';
import { validateLicense, type LicenseValidationResult } from './core/license.js';
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

const nuxenGradient = gradient(['#9333EA', '#3B82F6']);

const LicenseInvalidScreen: React.FC<{ reason: string }> = ({ reason }) => {
  const { exit } = useApp();
  useInput((_, key) => { if (key.return || key.escape || _.toLowerCase() === 'q') exit(); });
  return (
    <Box flexDirection="column" padding={2} gap={1}>
      <Text>{nuxenGradient('NUXEN')}</Text>
      <Text color="#EF4444" bold>⚠  Licence invalide</Text>
      <Text color="#F87171">   {reason}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="#9CA3AF">Pour obtenir une clé de licence, contacte l'admin.</Text>
        <Text color="#9CA3AF">Édite ensuite license_key dans config.json puis relance.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="#6B7280">Appuie sur Q ou Entrée pour quitter.</Text>
      </Box>
    </Box>
  );
};

// ─── Root component ────────────────────────────────────────────────────────────
const Root: React.FC = () => {
  type Phase =
    | { phase: 'checkingUpdate' }
    | { phase: 'update'; result: UpdateCheckResult }
    | { phase: 'checkingLicense' }
    | { phase: 'licenseInvalid'; reason: string }
    | { phase: 'ready' };

  const [state, setState] = useState<Phase>({ phase: 'checkingUpdate' });

  useEffect(() => {
    const run = async () => {
      // 1. Erreur de chargement → skip tout
      if (_loadError || _firstRun) {
        setState({ phase: 'ready' });
        return;
      }

      // 2. Vérification update
      try {
        const result = await checkForUpdate();
        if (result.hasUpdate && result.remoteVersion) {
          setState({ phase: 'update', result });
          return;
        }
      } catch { /* ignore: skip update */ }

      // 3. Vérification licence
      setState({ phase: 'checkingLicense' });
      try {
        const lic: LicenseValidationResult = await validateLicense(
          _config.license_key,
          APP_VERSION,
        );
        if (!lic.valid) {
          setState({ phase: 'licenseInvalid', reason: lic.reason ?? 'Inconnu' });
          return;
        }
      } catch (e: any) {
        setState({ phase: 'licenseInvalid', reason: e.message ?? 'Erreur validation' });
        return;
      }

      setState({ phase: 'ready' });
    };
    run();
  }, []);

  // Update available
  if (state.phase === 'update') {
    return (
      <UpdateScreen
        result={state.result}
        onDownload={(onProgress) => downloadAndApplyUpdate(state.result, onProgress)}
        onSkip={() => setState({ phase: 'checkingLicense' })}
      />
    );
  }

  // Loading screens
  if (state.phase === 'checkingUpdate') {
    return (
      <Box padding={1} gap={1}>
        <Text color="#6B7280">⟳</Text>
        <Text color="#4B5563">Vérification des mises à jour</Text>
        <Text color="#374151">(v{APP_VERSION})</Text>
      </Box>
    );
  }
  if (state.phase === 'checkingLicense') {
    return (
      <Box padding={1} gap={1}>
        <Text color="#6B7280">⟳</Text>
        <Text color="#4B5563">Vérification de la licence...</Text>
      </Box>
    );
  }

  // Erreur licence
  if (state.phase === 'licenseInvalid') {
    return <LicenseInvalidScreen reason={state.reason} />;
  }

  // Erreur de chargement de config
  if (_loadError) {
    return <ExitScreen lines={[`Erreur chargement config: ${_loadError}`]} isError />;
  }

  // First run
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
        '1. Édite config.json (clé Capsolver + license_key + webhook par défaut)',
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
