import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Picker, type PickerOption } from './Picker.js';
import { Header } from './Header.js';
import { TasksDashboard } from './TasksDashboard.js';
import { MenuBar } from './MenuBar.js';
import { store, type GlobalStore } from '../core/store.js';
import { startFromRows, stopAll, restartAll, retryErrors, changeTaskFile } from '../core/orchestrator.js';
import { listModules, type AppConfig } from '../config/loader.js';
import { parseTaskCsv, type TaskRow } from '../config/taskCsv.js';
import path from 'path';

type Screen = 'modulePick' | 'taskFilePick' | 'dashboard';

interface AppProps {
  config: AppConfig;
  configErrors: string[];
}

const useElapsed = (isRunning: boolean) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (isRunning) {
      startRef.current = Date.now();
      setElapsed(0);
    }
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const s = elapsed % 60;
  const m = Math.floor(elapsed / 60);
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
};

export const App: React.FC<AppProps> = ({ config, configErrors }) => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('modulePick');
  const [storeState, setStoreState] = useState<GlobalStore>(store.state);
  const [pickerError, setPickerError] = useState<string>('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoRetry, setAutoRetry] = useState(false);
  const [autoRetryCountdown, setAutoRetryCountdown] = useState(0);
  const [selectedModule, setSelectedModule] = useState<string>('');
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedStr = useElapsed(storeState.isRunning);

  const modules = listModules();

  // Subscribe to store
  useEffect(() => {
    const onChange = () => setStoreState({ ...store.state });
    store.on('change', onChange);
    return () => { store.off('change', onChange); };
  }, []);

  // Auto-retry logic
  useEffect(() => {
    if (!autoRetry || storeState.isRunning || screen !== 'dashboard') return;
    if (storeState.tasks.length === 0) return;

    const allDone = storeState.tasks.every(t =>
      ['success', 'error', 'stopped'].includes(t.status)
    );
    const hasErrors = storeState.tasks.some(t => t.status === 'error' || t.status === 'stopped');
    if (!allDone || !hasErrors) return;

    let countdown = 30;
    setAutoRetryCountdown(countdown);
    const tick = setInterval(() => {
      countdown--;
      setAutoRetryCountdown(countdown);
      if (countdown <= 0) {
        clearInterval(tick);
        setAutoRetryCountdown(0);
        retryErrors(config);
      }
    }, 1000);
    autoRetryTimerRef.current = tick as any;
    return () => clearInterval(tick);
  }, [storeState.isRunning, autoRetry, screen]);

  // Global key bindings (dashboard only)
  useInput((char, key) => {
    if (screen !== 'dashboard') return;
    const upperChar = char.toUpperCase();

    if (upperChar === 'Q') {
      stopAll();
      setTimeout(() => exit(), 300);
      return;
    }
    if (upperChar === 'C') {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      setAutoRetry(false);
      setAutoRetryCountdown(0);
      changeTaskFile();
      setScrollOffset(0);
      setSelectedModule('');
      setScreen('modulePick');
      return;
    }
    if (upperChar === 'S' && storeState.isRunning) {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryCountdown(0);
      }
      stopAll();
      return;
    }
    if (upperChar === 'R' && !storeState.isRunning) {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryCountdown(0);
      }
      restartAll(config);
      return;
    }
    if (upperChar === 'A') {
      setAutoRetry(prev => {
        if (prev && autoRetryTimerRef.current) {
          clearInterval(autoRetryTimerRef.current);
          autoRetryTimerRef.current = null;
          setAutoRetryCountdown(0);
        }
        return !prev;
      });
      return;
    }
    if (upperChar === 'T' || key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 5));
      return;
    }
    if (upperChar === 'B' || key.downArrow) {
      setScrollOffset(prev => prev + 5);
      return;
    }
  });

  // Config errors
  if (configErrors.length > 0) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="#EF4444" bold>[!] Configuration incomplete</Text>
        {configErrors.map((e, i) => <Text key={i} color="#F87171">  - {e}</Text>)}
        <Text color="#9CA3AF">Edite config.json puis relance Nuxen.exe</Text>
      </Box>
    );
  }

  // ÔöÇÔöÇÔöÇ ├ëcran 1: Choix du module ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  if (screen === 'modulePick') {
    const moduleOptions: PickerOption[] = modules.map(m => ({
      id: m.name,
      label: m.name,
      hint: `${m.taskFiles.length} fichier${m.taskFiles.length > 1 ? 's' : ''}`,
      disabled: m.taskFiles.length === 0,
    }));

    return (
      <Picker
        title="MODULE"
        subtitle="Choisis le site cible"
        options={moduleOptions}
        showLogo
        error={pickerError}
        emptyMessage="Aucun module avec des fichiers task. Ajoute des CSV dans TicketMaster/"
        onSelect={(id) => {
          setSelectedModule(id);
          setPickerError('');
          setScreen('taskFilePick');
        }}
      />
    );
  }

  // ÔöÇÔöÇÔöÇ ├ëcran 2: Choix du fichier task ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  if (screen === 'taskFilePick') {
    const mod = modules.find(m => m.name === selectedModule);
    const fileOptions: PickerOption[] = (mod?.taskFiles ?? []).map(f => ({
      id: f, label: f,
    }));

    return (
      <Picker
        title={`${selectedModule.toUpperCase()} - TASK FILE`}
        subtitle="Choisis le fichier de taches a lancer"
        options={fileOptions}
        showLogo
        error={pickerError}
        emptyMessage={`Aucun .csv dans ${selectedModule}/`}
        onBack={() => {
          setSelectedModule('');
          setPickerError('');
          setScreen('modulePick');
        }}
        onSelect={(filename) => {
          if (!mod) return;
          const fullPath = path.join(mod.dir, filename);
          let parsed;
          try { parsed = parseTaskCsv(fullPath); }
          catch (e: any) {
            setPickerError(`Erreur lecture CSV: ${e.message}`);
            return;
          }

          if (parsed.errors.length > 0 && parsed.rows.length === 0) {
            setPickerError(parsed.errors.map(e => `Ligne ${e.row}: ${e.message}`).join(' | '));
            return;
          }

          // Lancer
          const result = startFromRows(parsed.rows, config, filename);
          if (result.errors.length > 0 && storeState.tasks.length === 0) {
            setPickerError(result.errors.join(' | '));
            return;
          }

          setPickerError('');
          setScrollOffset(0);
          setScreen('dashboard');
        }}
      />
    );
  }

  // ÔöÇÔöÇÔöÇ Dashboard ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const tasks = storeState.tasks;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const errorCount = tasks.filter(t => t.status === 'error').length;
  const runningCount = tasks.filter(t => !['success', 'error', 'stopped', 'idle'].includes(t.status)).length;
  const queuedCount = tasks.filter(t => t.status === 'queued').length;

  const eventName = storeState.taskFileName
    ? storeState.taskFileName.replace(/\.csv$/i, '')
    : '';

  return (
    <Box flexDirection="column">
      <Header
        taskCount={tasks.length}
        eventName={eventName}
        isRunning={storeState.isRunning}
      />

      <Box paddingX={2} paddingBottom={1} gap={2}>
        <Text color="#22C55E">[OK] {successCount} succes</Text>
        <Text color="#EF4444">[X] {errorCount} erreurs</Text>
        <Text color="#9333EA">[~] {runningCount} en cours</Text>
        {queuedCount > 0 && <Text color="#38BDF8">[Q] {queuedCount} en file</Text>}
        {storeState.isRunning && <Text color="#4B5563">{elapsedStr}</Text>}
        {autoRetry && (
          <Text color={autoRetryCountdown > 0 ? '#F59E0B' : '#22C55E'}>
            {autoRetryCountdown > 0 ? `[A] retry dans ${autoRetryCountdown}s` : '[A] auto-retry ON'}
          </Text>
        )}
      </Box>

      <TasksDashboard tasks={tasks} scrollOffset={scrollOffset} />

      <MenuBar isRunning={storeState.isRunning} autoRetry={autoRetry} />
    </Box>
  );
};
