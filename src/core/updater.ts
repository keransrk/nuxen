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

  // Chemins
  const currentExe = process.execPath;
  const currentDir = path.dirname(currentExe);
  const tmpZip = path.join(os.tmpdir(), 'nuxen_update.zip');
  const extractDir = path.join(os.tmpdir(), 'nuxen_update_extract');
  const finalExe = path.join(currentDir, 'Nuxen.exe');

  // 1. Telecharger le zip
  onProgress?.(`Telechargement v${result.remoteVersion}...`);
  await downloadFile(result.downloadUrl, tmpZip, (pct) => {
    onProgress?.(`Telechargement v${result.remoteVersion}... ${pct}%`);
  });

  onProgress?.('Preparation du relancement...');

  // 2. Ecrire le script PowerShell de remplacement
  //    Il sera execute APRES process.exit(0), donc Nuxen.exe sera libere
  const ps1Path = path.join(os.tmpdir(), 'nuxen_update.ps1');
  const ps1Lines = [
    `$zip = '${tmpZip}'`,
    `$extract = '${extractDir}'`,
    `$final = '${finalExe}'`,
    '',
    '# Attendre que Nuxen.exe soit ferme',
    'Start-Sleep -Seconds 3',
    '',
    '# Nettoyer ancien dossier d extraction si besoin',
    'if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }',
    '',
    '# Extraire le zip',
    'Expand-Archive -Path $zip -DestinationPath $extract -Force',
    '',
    '# Remplacer Nuxen.exe',
    '$newExe = Join-Path $extract "Nuxen.exe"',
    'if (Test-Path $newExe) {',
    '  if (Test-Path $final) { Remove-Item $final -Force -ErrorAction SilentlyContinue }',
    '  Copy-Item $newExe $final -Force',
    '  Start-Process $final',
    '}',
    '',
    '# Nettoyage',
    'Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue',
    'Remove-Item -Force $zip -ErrorAction SilentlyContinue',
    'Remove-Item $PSCommandPath -ErrorAction SilentlyContinue',
  ];
  fs.writeFileSync(ps1Path, ps1Lines.join('\r\n'), 'utf8');

  // 3. Lancer le script PowerShell en tache de fond (detache)
  spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', ps1Path,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  // 4. Quitter — PowerShell prend le relai
  onProgress?.('Fermeture...');
  await new Promise(r => setTimeout(r, 1500));
  process.exit(0);
};
