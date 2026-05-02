import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { EventPrompt } from './EventPrompt.js';
import { Header } from './Header.js';
import { TasksDashboard } from './TasksDashboard.js';
import { MenuBar } from './MenuBar.js';
import { store, type GlobalStore } from '../core/store.js';
import { startAll, stopAll, restartAll, retryErrors, changeEvent } from '../core/orchestrator.js';
import { resolveEventUrl } from '../core/eventResolver.js';
import type { AppConfig, ProxyEntry } from '../config/loader.js';

type Screen = 'prompt' | 'dashboard';

interface AppProps {
  config: AppConfig;
  proxies: ProxyEntry[];
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

export const App: React.FC<AppProps> = ({ config, proxies, configErrors }) => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('prompt');
  const [storeState, setStoreState] = useState<GlobalStore>(store.state);
  const [promptError, setPromptError] = useState<string>('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoRetry, setAutoRetry] = useState(false);
  const [autoRetryCountdown, setAutoRetryCountdown] = useState(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedStr = useElapsed(storeState.isRunning);

  // Subscribe to store
  useEffect(() => {
    const onChange = () => setStoreState({ ...store.state });
    store.on('change', onChange);
    return () => { store.off('change', onChange); };
  }, []);

  // Auto-retry logic: when all tasks are done and auto-retry is on
  useEffect(() => {
    if (!autoRetry || storeState.isRunning || screen !== 'dashboard') return;
    if (storeState.tasks.length === 0) return;

    const allDone = storeState.tasks.every(t =>
      ['success', 'error', 'stopped'].includes(t.status)
    );
    const hasErrors = storeState.tasks.some(t => t.status === 'error' || t.status === 'stopped');

    if (!allDone || !hasErrors) return;

    // Start 30s countdown
    let countdown = 30;
    setAutoRetryCountdown(countdown);

    const tick = setInterval(() => {
      countdown--;
      setAutoRetryCountdown(countdown);
      if (countdown <= 0) {
        clearInterval(tick);
        setAutoRetryCountdown(0);
        retryErrors(proxies, config);
      }
    }, 1000);

    autoRetryTimerRef.current = tick as any;
    return () => clearInterval(tick);
  }, [storeState.isRunning, autoRetry, screen]);

  // Global key bindings
  useInput((char, key) => {
    if (screen !== 'dashboard') return;
    const upperChar = char.toUpperCase();

    // Quit app
    if (upperChar === 'Q' && !focusMode) {
      stopAll();
      setTimeout(() => exit(), 300);
      return;
    }

    // Change event → back to prompt
    if (upperChar === 'C' && !focusMode) {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      setAutoRetry(false);
      setAutoRetryCountdown(0);
      changeEvent();
      setScrollOffset(0);
      setScreen('prompt');
      return;
    }

    // Stop all
    if (upperChar === 'S' && !focusMode && storeState.isRunning) {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryCountdown(0);
      }
      stopAll();
      return;
    }

    // Restart all (when stopped)
    if (upperChar === 'R' && !focusMode && !storeState.isRunning) {
      if (autoRetryTimerRef.current) {
        clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryCountdown(0);
      }
      restartAll(proxies, config);
      return;
    }

    // Auto-retry toggle
    if (upperChar === 'A' && !focusMode) {
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

    // Scroll up
    if ((upperChar === 'T' || key.upArrow)) {
      setScrollOffset(prev => Math.max(0, prev - 5));
      return;
    }

    // Scroll down
    if ((upperChar === 'B' || key.downArrow)) {
      setScrollOffset(prev => prev + 5);
      return;
    }
  });

  // Config errors
  if (configErrors.length > 0) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="#EF4444" bold>⚠ Configuration incomplète</Text>
        {configErrors.map((e, i) => <Text key={i} color="#F87171">  • {e}</Text>)}
        <Text color="#9CA3AF" marginTop={1}>Éditez config/config.csv puis relancez NUXEN.exe</Text>
      </Box>
    );
  }

  // Prompt screen
  if (screen === 'prompt') {
    return (
      <EventPrompt
        proxyCount={proxies.length}
        error={promptError}
        onSubmit={(url) => {
          try {
            resolveEventUrl(url);
            setPromptError('');
            setScrollOffset(0);
            setScreen('dashboard');
            startAll(url, proxies, config);
          } catch (e: any) {
            setPromptError(e.message);
          }
        }}
      />
    );
  }

  // Dashboard
  const tasks = storeState.tasks;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const errorCount = tasks.filter(t => t.status === 'error').length;
  const runningCount = tasks.filter(t => !['success', 'error', 'stopped', 'idle'].includes(t.status)).length;
  const queuedCount = tasks.filter(t => t.status === 'queued').length;

  const eventName = storeState.slug
    ? storeState.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : '';

  return (
    <Box flexDirection="column">
      <Header
        taskCount={tasks.length}
        eventName={eventName}
        isRunning={storeState.isRunning}
      />

      {/* Stats bar */}
      <Box paddingX={2} paddingBottom={1} gap={2}>
        <Text color="#22C55E">✓ {successCount} succès</Text>
        <Text color="#EF4444">✗ {errorCount} erreurs</Text>
        <Text color="#9333EA">◑ {runningCount} en cours</Text>
        {queuedCount > 0 && <Text color="#38BDF8">⏳ {queuedCount} en file</Text>}
        {storeState.isRunning && <Text color="#4B5563">⏱ {elapsedStr}</Text>}
        {autoRetry && (
          <Text color={autoRetryCountdown > 0 ? '#F59E0B' : '#22C55E'}>
            {autoRetryCountdown > 0 ? `↻ retry dans ${autoRetryCountdown}s` : '↻ auto-retry ON'}
          </Text>
        )}
      </Box>

      <TasksDashboard
        tasks={tasks}
        scrollOffset={scrollOffset}
      />

      <MenuBar
        isRunning={storeState.isRunning}
        autoRetry={autoRetry}
      />
    </Box>
  );
};
