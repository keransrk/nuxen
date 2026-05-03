import fs from 'fs';
import path from 'path';
import { PATHS } from './loader.js';

export interface ProxyEntry {
  url: string;
  label: string;
}

export const loadProxyFile = (filename: string): ProxyEntry[] => {
  // Resolution: si chemin relatif, chercher dans Proxies/
  const fullPath = path.isAbsolute(filename)
    ? filename
    : path.join(PATHS.proxiesDir, filename);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Fichier proxies introuvable: ${filename} (cherche dans ${PATHS.proxiesDir})`);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const proxies: ProxyEntry[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Si la ligne commence deja par http:// ou https://, on garde tel quel
    // Sinon on ajoute http:// automatiquement
    let url = line;
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }

    // Extraction du label (session ID ou suffixe)
    const sessionMatch = line.match(/session-(\d+)/);
    const label = sessionMatch ? `…${sessionMatch[1].slice(-6)}` : line.slice(-12);

    proxies.push({ url, label });
  }

  return proxies;
};
