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
  exeName?: string;
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

  // Chercher le zip de distribution (Nuxen-X.X.X.zip)
  const asset = release.assets.find(a => a.name.match(/^Nuxen.*\.zip$/i))
    // Fallback: exe direct pour compatibilité avec anciennes releases
    ?? release.assets.find(a => a.name.match(/^Nuxen.*\.exe$/i));

  // Nom de l'exe dans le zip (même nom, extension .exe)
  const exeName = asset?.name.replace(/\.zip$/i, '.exe');

  return {
    hasUpdate,
    remoteVersion,
    currentVersion: APP_VERSION,
    downloadUrl: asset?.browser_download_url,
    assetName: asset?.name,
    exeName,
  };
};

export const downloadAndApplyUpdate = async (
  result: UpdateCheckResult,
  onProgress?: (msg: string) => void
): Promise<void> => {
  if (!result.downloadUrl || !result.assetName) {
    throw new Error('Aucun asset trouvé dans la release GitHub');
  }

  const currentExe = process.execPath;
  const currentDir = path.dirname(currentExe);
  const isZip = result.assetName.endsWith('.zip');
  const exeName = result.exeName ?? result.assetName.replace(/\.zip$/i, '.exe');
  const newExe = path.join(currentDir, exeName);

  // Supprimer les anciennes versions Nuxen-*.exe et .zip dans le dossier
  try {
    const files = fs.readdirSync(currentDir);
    for (const f of files) {
      if (/^Nuxen.*\.(exe|zip)$/i.test(f) && f !== result.assetName && f !== exeName) {
        const oldPath = path.join(currentDir, f);
        if (oldPath.toLowerCase() !== currentExe.toLowerCase()) {
          try { fs.unlinkSync(oldPath); } catch { /* ignoré si locked */ }
        }
      }
    }
  } catch { /* dossier inaccessible, on ignore */ }

  if (isZip) {
    // ─── Téléchargement du ZIP ────────────────────────────────────────────────
    const tmpZip = path.join(os.tmpdir(), `Nuxen_update_${Date.now()}.zip`);
    const extractDir = path.join(os.tmpdir(), `Nuxen_extract_${Date.now()}`);

    onProgress?.(`Téléchargement ${result.assetName}...`);
    await downloadFile(result.downloadUrl, tmpZip, (pct) => {
      onProgress?.(`Téléchargement ${result.assetName}... ${pct}%`);
    });
    onProgress?.('Extraction et remplacement en cours...');

    // Extraction + remplacement via PowerShell inline (sans fichier temporaire)
    // - Expand-Archive extrait le zip
    // - On récupère l'exe depuis le dossier extrait
    // - On le déplace vers le dossier final
    // - On lance le nouvel exe
    const cmd = [
      `ping 127.0.0.1 -n 3 > nul`,
      `powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${extractDir}' -Force"`,
      `move /y "${extractDir}\\${exeName}" "${newExe}"`,
      `rmdir /s /q "${extractDir}" 2>nul`,
      `del /f /q "${tmpZip}" 2>nul`,
      `start "" "${newExe}"`,
    ].join(' & ');

    spawn('cmd.exe', ['/c', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    // ─── Fallback: téléchargement direct exe (anciennes releases) ─────────────
    const tmpExe = path.join(os.tmpdir(), `Nuxen_update_${Date.now()}.exe`);

    onProgress?.(`Téléchargement ${result.assetName}...`);
    await downloadFile(result.downloadUrl, tmpExe, (pct) => {
      onProgress?.(`Téléchargement ${result.assetName}... ${pct}%`);
    });
    onProgress?.('Remplacement en cours...');

    const cmd = `ping 127.0.0.1 -n 3 > nul & move /y "${tmpExe}" "${newExe}" & start "" "${newExe}"`;
    spawn('cmd.exe', ['/c', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }

  process.exit(0);
};
