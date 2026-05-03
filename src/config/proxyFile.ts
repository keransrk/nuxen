import fs from 'fs';
import path from 'path';
import { PATHS } from './loader.js';

export interface ProxyEntry {
  url: string;
  label: string;
}

// Pool de proxies avec rotation automatique
export class ProxyPool {
  private proxies: ProxyEntry[];
  private index: number;

  constructor(proxies: ProxyEntry[]) {
    if (proxies.length === 0) throw new Error('ProxyPool: liste vide');
    this.proxies = [...proxies];
    // Depart aleatoire pour repartir la charge
    this.index = Math.floor(Math.random() * proxies.length);
  }

  get size(): number { return this.proxies.length; }

  get current(): ProxyEntry { return this.proxies[this.index]; }

  // Passe au proxy suivant (circulaire) et retourne le nouvel actif
  rotate(): ProxyEntry {
    this.index = (this.index + 1) % this.proxies.length;
    return this.proxies[this.index];
  }

  // Indique si une erreur ressemble a un blocage proxy
  static isProxyError(err: any): boolean {
    if (!err) return false;
    const code: string = err.code ?? '';
    const msg: string = String(err.message ?? '').toLowerCase();
    const status: number = err.status ?? err.statusCode ?? 0;
    // Codes reseau = proxy mort ou bloque
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
    // 407 = erreur auth proxy, 429 = rate limit
    if (status === 407 || status === 429) return true;
    // Messages explicites
    if (msg.includes('407') || msg.includes('proxy') || msg.includes('tunnel') || msg.includes('connect')) return true;
    return false;
  }
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
    const label = sessionMatch ? `ÔÇª${sessionMatch[1].slice(-6)}` : line.slice(-12);

    proxies.push({ url, label });
  }

  return proxies;
};
