import fs from 'fs';
import path from 'path';

export interface AppConfig {
  capsolver_api_key: string;
  discord_webhook_url: string;
  discord_user_id_to_ping: string;
  qty_min: number;
  qty_max: number;
  poll_status_max_minutes: number;
  request_delay_ms: number;
}

export interface ProxyEntry {
  url: string;
  label: string;
}

const EXE_DIR = path.dirname(process.execPath ?? process.argv[1] ?? process.cwd());
const CONFIG_DIR = path.join(EXE_DIR, 'config');
const CONFIG_CSV = path.join(CONFIG_DIR, 'config.csv');
const PROXIES_CSV = path.join(CONFIG_DIR, 'proxies.csv');

const CONFIG_TEMPLATE = `key,value
capsolver_api_key,CAP-XXXXX_REMPLACER_PAR_VOTRE_CLE
discord_webhook_url,https://discord.com/api/webhooks/REMPLACER
discord_user_id_to_ping,
qty_min,1
qty_max,2
poll_status_max_minutes,30
request_delay_ms,3000
`;

const PROXIES_TEMPLATE = `# Un proxy par ligne (format: http://user:pass@host:port)
# Exemple PacketStream (remplacer session et identifiants):
http://10028496:HTC0V7oRwHA67_country-FRANCE_session-11111111@proxy-eu.packetstream.vip:31112
http://10028496:HTC0V7oRwHA67_country-FRANCE_session-22222222@proxy-eu.packetstream.vip:31112
`;

const ensureConfigDir = () => {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
};

const createTemplates = () => {
  ensureConfigDir();
  let created = false;
  if (!fs.existsSync(CONFIG_CSV)) {
    fs.writeFileSync(CONFIG_CSV, CONFIG_TEMPLATE);
    created = true;
  }
  if (!fs.existsSync(PROXIES_CSV)) {
    fs.writeFileSync(PROXIES_CSV, PROXIES_TEMPLATE);
    created = true;
  }
  return created;
};

export const loadConfig = (): { config: AppConfig; proxies: ProxyEntry[]; created: boolean } => {
  const created = createTemplates();

  // Parse config.csv
  const configLines = fs.readFileSync(CONFIG_CSV, 'utf8').split('\n');
  const configMap: Record<string, string> = {};
  for (const line of configLines) {
    if (line.startsWith('#') || !line.includes(',')) continue;
    const idx = line.indexOf(',');
    const k = line.substring(0, idx).trim();
    const v = line.substring(idx + 1).trim();
    if (k && k !== 'key') configMap[k] = v;
  }

  const config: AppConfig = {
    capsolver_api_key: configMap.capsolver_api_key || '',
    discord_webhook_url: configMap.discord_webhook_url || '',
    discord_user_id_to_ping: configMap.discord_user_id_to_ping || '',
    qty_min: parseInt(configMap.qty_min || '1'),
    qty_max: parseInt(configMap.qty_max || '2'),
    poll_status_max_minutes: parseInt(configMap.poll_status_max_minutes || '30'),
    request_delay_ms: parseInt(configMap.request_delay_ms || '3000'),
  };

  // Parse proxies.csv
  const proxyLines = fs.readFileSync(PROXIES_CSV, 'utf8').split('\n');
  const proxies: ProxyEntry[] = [];
  for (const line of proxyLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Extract a short label from the proxy URL (last part of session)
    const sessionMatch = trimmed.match(/session-(\d+)/);
    const label = sessionMatch ? `…${sessionMatch[1].slice(-6)}` : trimmed.slice(-12);
    proxies.push({ url: trimmed, label });
  }

  return { config, proxies, created };
};

export const validateConfig = (config: AppConfig): string[] => {
  const errors: string[] = [];
  if (!config.capsolver_api_key || config.capsolver_api_key.includes('REMPLACER'))
    errors.push('capsolver_api_key manquant dans config/config.csv');
  if (!config.discord_webhook_url || config.discord_webhook_url.includes('REMPLACER'))
    errors.push('discord_webhook_url manquant dans config/config.csv');
  return errors;
};
