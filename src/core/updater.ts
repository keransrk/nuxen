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
  if (GITHUB_REPO === 'TON_USERNAME/nuxen') {
    return { hasUpdate: false, currentVersion: APP_VERSION };
  }

  const release: GithubRelease = await fetchJson(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  );

  const remoteVersion = release.tag_name?.replace(/^v/, '') ?? '';
  const hasUpdate = isNewer(remoteVersion, APP_VERSION);

  // Chercher l'asset .exe (ex: Nuxen-1.0.3.exe)
  const asset = release.assets.find(a => a.name.match(/^Nuxen.*\.exe$/i));

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
    throw new Error('Aucun asset .exe trouvé dans la release GitHub');
  }

  const currentExe = process.execPath;
  const currentDir = path.dirname(currentExe);

  // Téléchargement dans le dossier temp du système (pas dans le dossier du bot)
  const tmpExe = path.join(os.tmpdir(), `Nuxen_update_${Date.now()}.exe`);

  onProgress?.(`Téléchargement ${result.assetName}...`);
  await downloadFile(result.downloadUrl, tmpExe, (pct) => {
    onProgress?.(`Téléchargement ${result.assetName}... ${pct}%`);
  });
  onProgress?.('Téléchargement terminé — remplacement en cours...');

  // Determine the final exe path (same dir, new name)
  const newExe = path.join(currentDir, result.assetName);

  // Supprimer les anciennes versions Nuxen-*.exe (sauf le current exe en cours d'exécution)
  try {
    const files = fs.readdirSync(currentDir);
    for (const f of files) {
      if (/^Nuxen.*\.exe$/i.test(f) && f !== result.assetName) {
        const oldPath = path.join(currentDir, f);
        if (oldPath.toLowerCase() !== currentExe.toLowerCase()) {
          try { fs.unlinkSync(oldPath); } catch { /* ignoré si locked */ }
        }
      }
    }
  } catch { /* dossier inaccessible, on ignore */ }

  // Inline cmd command: wait 2s, move temp→final, launch new, done
  // No .ps1 file created — everything inline
  const cmd = `ping 127.0.0.1 -n 3 > nul & move /y "${tmpExe}" "${newExe}" & start "" "${newExe}"`;

  spawn('cmd.exe', ['/c', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  process.exit(0);
};
