import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFileSync } from 'child_process';
import { APP_VERSION, GITHUB_REPO } from '../version.js';

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

const fetchJson = (url: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'NUXEN-Bot', Accept: 'application/vnd.github+json' },
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchJson(res.headers.location!).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });

const downloadFile = (url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const follow = (u: string) => {
      https.get(u, { headers: { 'User-Agent': 'NUXEN-Bot' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return follow(res.headers.location!);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress?.(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });

const parseVersion = (v: string): number[] =>
  v.replace(/^v/, '').split('.').map(Number);

const isNewer = (remote: string, local: string): boolean => {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
};

export interface UpdateCheckResult {
  hasUpdate: boolean;
  remoteVersion?: string;
  currentVersion: string;
  downloadUrl?: string;
  assetName?: string;
}

export const checkForUpdate = async (): Promise<UpdateCheckResult> => {
  if (!GITHUB_REPO || GITHUB_REPO === 'TON_USERNAME/nuxen') {
    return { hasUpdate: false, currentVersion: APP_VERSION };
  }

  const release: GithubRelease = await fetchJson(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  );

  const remoteVersion = release.tag_name?.replace(/^v/, '') ?? '';
  const hasUpdate = isNewer(remoteVersion, APP_VERSION);
  const asset = release.assets.find(a => a.name.match(/^Nuxen.*\.zip$/i));

  return {
    hasUpdate,
    remoteVersion,
    currentVersion: APP_VERSION,
    downloadUrl: asset?.browser_download_url,
    assetName: asset?.name,
  };
};

export const downloadAndApplyUpdate = async (
  result: UpdateCheckResult,
  onProgress?: (msg: string) => void
): Promise<void> => {
  if (!result.downloadUrl || !result.assetName) {
    throw new Error('Aucun asset zip trouve dans la release GitHub');
  }

  const currentDir = path.dirname(process.execPath);
  const tmpZip = path.join(os.tmpdir(), 'nuxen_update.zip');
  const extractDir = path.join(os.tmpdir(), 'nuxen_extract');
  const stagingExe = path.join(currentDir, 'Nuxen_new.exe');
  const finalExe = path.join(currentDir, 'Nuxen.exe');
  const batchPath = path.join(currentDir, '_nuxen_update.bat');
  const extractPs1 = path.join(os.tmpdir(), 'nuxen_extract.ps1');

  // ── ETAPE 1: Telecharger le zip ──────────────────────────────────────────
  onProgress?.(`Telechargement v${result.remoteVersion}...`);
  await downloadFile(result.downloadUrl, tmpZip, (pct) => {
    onProgress?.(`Telechargement v${result.remoteVersion}... ${pct}%`);
  });

  // ── ETAPE 2: Extraire le zip (synchrone, pendant que le process tourne) ──
  // On utilise execFileSync (pas de shell intermédiaire = pas de problème de quotes)
  // Le staging exe a un nom different de Nuxen.exe = pas locked
  onProgress?.('Extraction...');

  fs.writeFileSync(extractPs1, [
    `if (Test-Path '${extractDir}') { Remove-Item -Recurse -Force '${extractDir}' }`,
    `Expand-Archive -Path '${tmpZip}' -DestinationPath '${extractDir}' -Force`,
    `Copy-Item (Join-Path '${extractDir}' 'Nuxen.exe') '${stagingExe}' -Force`,
    `Remove-Item -Recurse -Force '${extractDir}' -ErrorAction SilentlyContinue`,
    `Remove-Item '${tmpZip}' -Force -ErrorAction SilentlyContinue`,
    `Remove-Item $PSCommandPath -ErrorAction SilentlyContinue`,
  ].join('\r\n'), 'utf8');

  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', extractPs1,
    ], { timeout: 120000 });
  } catch {
    // execFileSync peut lancer une erreur meme si PS retourne 0 sur certains systemes
    // On verifie juste que le staging exe existe
  }

  if (!fs.existsSync(stagingExe)) {
    throw new Error('Extraction echouee : Nuxen_new.exe introuvable');
  }

  // ── ETAPE 3: Ecrire le batch de remplacement ──────────────────────────────
  // Simple : attendre que Nuxen.exe soit libere, del+move+start
  onProgress?.('Installation...');

  const batchLines = [
    '@echo off',
    'timeout /t 3 /nobreak > nul',
    // Boucle jusqu a ce que Nuxen.exe soit supprimable (plus locked)
    ':delloop',
    `del /f /q "${finalExe}" 2>nul`,
    `if exist "${finalExe}" ( timeout /t 1 /nobreak > nul & goto delloop )`,
    // Renommer le staging en Nuxen.exe
    `move /y "${stagingExe}" "${finalExe}"`,
    // Lancer le nouveau Nuxen.exe
    `start "" "${finalExe}"`,
    // Autosuppression du batch
    'del /f /q "%~f0"',
  ];
  fs.writeFileSync(batchPath, batchLines.join('\r\n'), 'ascii');

  // ── ETAPE 4: Spawner le batch detache via cmd.exe ─────────────────────────
  // Important : cmd.exe (pas powershell) car spawn detached + powershell ne fonctionne pas
  spawn('cmd.exe', ['/c', batchPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();

  // ── ETAPE 5: Quitter ──────────────────────────────────────────────────────
  onProgress?.('Fermeture...');
  await new Promise(r => setTimeout(r, 1500));
  process.exit(0);
};
