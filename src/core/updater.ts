import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
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

  // Chercher le zip de distribution (Nuxen-X.X.X.zip)
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

  const currentExe = process.execPath;
  const currentDir = path.dirname(currentExe);

  // Zip telecharge dans le dossier temp systeme
  const tmpZip = path.join(os.tmpdir(), `Nuxen_update_${Date.now()}.zip`);
  // Dossier d'extraction temporaire
  const extractDir = path.join(os.tmpdir(), `Nuxen_extract_${Date.now()}`);
  // Exe "staging" dans le meme dossier que l'exe actuel (nom differents pour contourner le lock Windows)
  const stagingExe = path.join(currentDir, 'Nuxen_new.exe');
  // Cible finale
  const finalExe = path.join(currentDir, 'Nuxen.exe');

  onProgress?.(`Telechargement v${result.remoteVersion}...`);
  await downloadFile(result.downloadUrl, tmpZip, (pct) => {
    onProgress?.(`Telechargement v${result.remoteVersion}... ${pct}%`);
  });

  onProgress?.('Extraction...');

  // Extraire le zip (PowerShell) — fait MAINTENANT pendant que le process tourne encore
  // On copie le nouvel exe sous le nom Nuxen_new.exe (pas locked)
  const extractNow = [
    `Expand-Archive -Path '${tmpZip}' -DestinationPath '${extractDir}' -Force`,
    `Copy-Item '${extractDir}\\Nuxen.exe' '${stagingExe}' -Force`,
    `Remove-Item -Recurse -Force '${extractDir}' -ErrorAction SilentlyContinue`,
    `Remove-Item -Force '${tmpZip}' -ErrorAction SilentlyContinue`,
  ].join('; ');

  try {
    const { execSync } = await import('child_process');
    execSync(`powershell -NoProfile -NonInteractive -Command "${extractNow}"`, { stdio: 'ignore' });
  } catch { /* ignore — le batch de remplacement gerera l'erreur */ }

  onProgress?.('Relancement en cours...');

  // Batch de remplacement : s'execute APRES process.exit(0)
  // Il attend que Nuxen.exe soit libere, le remplace par Nuxen_new.exe, puis relance
  const batchLines = [
    '@echo off',
    'ping 127.0.0.1 -n 4 > nul',
    `if exist "${stagingExe}" (`,
    `  del /f /q "${finalExe}"`,
    `  ren "${stagingExe}" "Nuxen.exe"`,
    `)`,
    `start "" "${finalExe}"`,
    'del /f /q "%~f0"',
  ];
  const batchPath = path.join(currentDir, '_nuxen_update.bat');
  fs.writeFileSync(batchPath, batchLines.join('\r\n'));

  spawn('cmd.exe', ['/c', batchPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false, // visible pour debug si ca coince
  }).unref();

  await new Promise(r => setTimeout(r, 1000));
  process.exit(0);
};
