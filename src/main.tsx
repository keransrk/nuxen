import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import gradient from 'gradient-string';
import { App } from './ui/App.js';
import { UpdateScreen } from './ui/UpdateScreen.js';
import { loadConfig, validateConfig, PATHS } from './config/loader.js';
import { checkForUpdate, downloadAndApplyUpdate, type UpdateCheckResult } from './core/updater.js';
import { validateLicense, type LicenseValidationResult } from './core/license.js';
import { APP_VERSION } from './version.js';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

process.title = 'NUXEN';

// Force UTF-8 sur la console Windows (évite les caractères garbled)
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }); } catch { /* ignore */ }
}

// Garde le process vivant quoi qu'il arrive — Bun sinon ferme si l'event loop se vide
process.stdin.resume();

// ─── Crash log ─────────────────────────────────────────────────────────────────
const CRASH_LOG = path.join(
  path.dirname(process.execPath ?? process.argv[1] ?? process.cwd()),
  'nuxen-crash.log',
);

const writeCrash = (msg: string) => {
  try { fs.appendFileSync(CRASH_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
};

process.on('uncaughtException', (err) => writeCrash(`CRASH: ${err?.stack ?? err}`));
process.on('unhandledRejection', (r) => writeCrash(`REJECTION: ${r}`));

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
  writeCrash(`CONFIG LOAD: ${_loadError}`);
  _config = {} as any;
}

const configErrors = _loadError ? [] : validateConfig(_config!);

// ─── Helpers ───────────────────────────────────────────────────────────────────
const nuxenGradient = gradient(['#9333EA', '#3B82F6']);

const WaitScreen: React.FC<{ lines: string[]; isError?: boolean }> = ({ lines, isError }) => {
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

const LicenseInvalidScreen: React.FC<{ reason: string }> = ({ reason }) => {
  const { exit } = useApp();
  useInput(() => exit());
  return (
    <Box flexDirection="column" padding={2} gap={1}>
      <Text>{nuxenGradient('NUXEN')}</Text>
      <Text color="#EF4444" bold>  Licence invalide</Text>
      <Text color="#F87171">  {reason}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="#9CA3AF">Pour obtenir une clé de licence, contacte l'admin.</Text>
        <Text color="#9CA3AF">Édite ensuite license_key dans config.json puis relance.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="#6B7280">Appuie sur n'importe quelle touche pour quitter.</Text>
      </Box>
    </Box>
  );
};

const UpdateConfirmScreen: React.FC<{
  result: UpdateCheckResult;
  onConfirm: () => void;
  onSkip: () => void;
}> = ({ result, onConfirm, onSkip }) => {
  useInput((char) => {
    const c = char.toUpperCase();
    if (c === 'O' || c === 'Y') onConfirm();
    if (c === 'N') onSkip();
  });
  return (
    <Box flexDirection="column" padding={2} gap={1}>
      <Text>{nuxenGradient('NUXEN')}</Text>
      <Text color="#7C3AED" bold>  Mise à jour disponible</Text>
      <Box gap={2} marginTop={1}>
        <Text color="#6B7280">Version actuelle :</Text>
        <Text color="#EF4444">v{result.currentVersion}</Text>
        <Text color="#6B7280">→</Text>
        <Text color="#22C55E" bold>v{result.remoteVersion}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="#D1D5DB">Installer la mise à jour ? </Text>
        <Text color="#22C55E" bold>[O]</Text>
        <Text color="#D1D5DB"> oui  </Text>
        <Text color="#EF4444" bold>[N]</Text>
        <Text color="#D1D5DB"> non (continuer sans mettre à jour)</Text>
      </Box>
    </Box>
  );
};

// ─── Root component ────────────────────────────────────────────────────────────
const Root: React.FC = () => {
  type Phase =
    | { phase: 'checkingUpdate' }
    | { phase: 'confirmUpdate'; result: UpdateCheckResult }
    | { phase: 'downloading'; result: UpdateCheckResult }
    | { phase: 'checkingLicense' }
    | { phase: 'licenseInvalid'; reason: string }
    | { phase: 'ready' };

  const [state, setState] = useState<Phase>({ phase: 'checkingUpdate' });

  useEffect(() => {
    const run = async () => {
      if (_loadError || _firstRun) {
        setState({ phase: 'ready' });
        return;
      }

      // 1. Vérification update
      try {
        const result = await checkForUpdate();
        if (result.hasUpdate && result.remoteVersion) {
          setState({ phase: 'confirmUpdate', result });
          return; // attend la réponse de l'utilisateur
        }
      } catch { /* réseau indispo → on continue */ }

      // 2. Vérification licence
      await runLicenseCheck();
    };
    run();
  }, []);

  const runLicenseCheck = async () => {
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

  // ── Vérif update ──
  if (state.phase === 'checkingUpdate') {
    return (
      <Box padding={1} gap={1}>
        <Text color="#6B7280">⟳</Text>
        <Text color="#4B5563">Vérification des mises à jour</Text>
        <Text color="#374151">(v{APP_VERSION})</Text>
      </Box>
    );
  }

  // ── Confirmation mise à jour ──
  if (state.phase === 'confirmUpdate') {
    return (
      <UpdateConfirmScreen
        result={state.result}
        onConfirm={() => setState({ phase: 'downloading', result: state.result })}
        onSkip={runLicenseCheck}
      />
    );
  }

  // ── Téléchargement en cours ──
  if (state.phase === 'downloading') {
    return (
      <UpdateScreen
        result={state.result}
        onDownload={(onProgress) => downloadAndApplyUpdate(state.result, onProgress)}
        onSkip={runLicenseCheck}
      />
    );
  }

  // ── Vérif licence ──
  if (state.phase === 'checkingLicense') {
    return (
      <Box padding={1} gap={1}>
        <Text color="#6B7280">⟳</Text>
        <Text color="#4B5563">Vérification de la licence...</Text>
      </Box>
    );
  }

  // ── Licence invalide ──
  if (state.phase === 'licenseInvalid') {
    return <LicenseInvalidScreen reason={state.reason} />;
  }

  // ── Erreur de config ──
  if (_loadError) {
    return <WaitScreen lines={[`Erreur chargement config: ${_loadError}`]} isError />;
  }

  // ── Premier lancement ──
  if (_firstRun) {
    return (
      <WaitScreen lines={[
        'Bienvenue sur NUXEN!',
        '',
        'Les fichiers de configuration ont été créés:',
        `  • ${PATHS.configJson}`,
        `  • ${PATHS.proxiesDir}\\proxies.txt`,
        `  • ${PATHS.ticketmasterDir}\\example.csv`,
        '',
        '1. Édite config.json (clé Capsolver + license_key + webhook)',
        '2. Édite Proxies/proxies.txt (tes proxies, un par ligne)',
        '3. Édite TicketMaster/example.csv ou crée tes propres CSV',
        '4. Relance NUXEN.exe',
      ]} />
    );
  }

  return <App config={_config!} configErrors={configErrors} />;
};

// ─── Render TUI ────────────────────────────────────────────────────────────────
try {
  render(<Root />, { exitOnCtrlC: true, patchConsole: false });
} catch (err: any) {
  writeCrash(`RENDER CRASH: ${err?.stack ?? err}`);
  console.error('\n[NUXEN] Erreur fatale:', err?.message ?? err);
  console.error('[NUXEN] Détails dans nuxen-crash.log');
  // stdin.resume() déjà appelé en haut — le process reste ouvert
}
