import { execSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import http from 'http';

// URL hardcodée dans le binaire — invisible dans config.json
const LICENSE_SERVER_URL = 'https://nuxen.sdss.fr';

// ─── HWID detection (Windows) ─────────────────────────────────────────────────
// On combine : MachineGuid (registre) + nom machine + MAC principale
// Resultat : un hash SHA-256 stable pour chaque PC
export const getHwid = (): string => {
  let machineGuid = '';
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 3000 }
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
    if (match) machineGuid = match[1];
  } catch { /* ignore */ }

  // Backup: MAC address de la 1ere interface non-loopback
  let mac = '';
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const iface of list ?? []) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac;
          break;
        }
      }
      if (mac) break;
    }
  } catch { /* ignore */ }

  const hostname = os.hostname();
  const raw = `${machineGuid}|${hostname}|${mac}`;

  return crypto.createHash('sha256').update(raw).digest('hex');
};

// ─── License validation ───────────────────────────────────────────────────────
export interface LicenseValidationResult {
  valid: boolean;
  reason?: string;
  label?: string;
  expiresAt?: number | null;
}

export const validateLicense = (
  key: string,
  version: string,
  timeoutMs = 8000
): Promise<LicenseValidationResult> => {
  return new Promise((resolve) => {
    if (!key || !key.trim()) {
      return resolve({ valid: false, reason: 'Aucune clé de licence dans config.json' });
    }

    const url = new URL('/api/validate', LICENSE_SERVER_URL);

    const lib = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({
      key: key.trim(),
      hwid: getHwid(),
      version,
    });

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `NUXEN/${version}`,
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            valid: !!parsed.valid,
            reason: parsed.reason,
            label: parsed.label,
            expiresAt: parsed.expiresAt,
          });
        } catch {
          resolve({ valid: false, reason: 'Réponse serveur invalide' });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ valid: false, reason: `Serveur licence injoignable: ${e.message}` });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ valid: false, reason: 'Timeout serveur licence' });
    });
    req.write(payload);
    req.end();
  });
};
