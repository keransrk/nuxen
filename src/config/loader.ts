import fs from 'fs';
import path from 'path';

export interface AppConfig {
  capsolver_api_key: string;
  default_webhook_url: string;
  poll_status_max_minutes: number;
  request_delay_ms: number;
  license_key: string;
}

const EXE_DIR = path.dirname(process.execPath ?? process.argv[1] ?? process.cwd());

export const PATHS = {
  exeDir: EXE_DIR,
  configJson: path.join(EXE_DIR, 'config.json'),
  proxiesDir: path.join(EXE_DIR, 'Proxies'),
  ticketmasterDir: path.join(EXE_DIR, 'TicketMaster'),
  queueitDir: path.join(EXE_DIR, 'Queue-it'),
};

const DEFAULT_CONFIG: AppConfig = {
  capsolver_api_key: 'CAP-XXXXX_REMPLACER_PAR_VOTRE_CLE',
  default_webhook_url: 'https://discord.com/api/webhooks/REMPLACER',
  poll_status_max_minutes: 30,
  request_delay_ms: 3000,
  license_key: '',
};

const PROXIES_TEMPLATE =
`# Un proxy par ligne (format: user:pass@host:port)
# NE PAS mettre http:// devant - c'est ajoute automatiquement
10028496:HTC0V7oRwHA67_country-FRANCE_session-11111111@proxy-eu.packetstream.vip:31112
10028496:HTC0V7oRwHA67_country-FRANCE_session-22222222@proxy-eu.packetstream.vip:31112
`;

const CSV_TEMPLATE =
`Mode,Url,Price_min,Price_max,Quantity_min,Quantity_max,Proxy_File,Accept_Contigous,Section,Offer_Code,Dates,Webhook
Drop,https://www.ticketmaster.fr/fr/manifestation/jul-billet/idmanif/640199,30,300,2,3,proxies.txt,true,406,,13/11/2026,
Drop,,,,,,proxies.txt,true,,,,
`;

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const setupTemplates = (): boolean => {
  let firstRun = false;

  if (!fs.existsSync(PATHS.configJson)) {
    fs.writeFileSync(PATHS.configJson, JSON.stringify(DEFAULT_CONFIG, null, 2));
    firstRun = true;
  }

  ensureDir(PATHS.proxiesDir);
  const proxiesTxt = path.join(PATHS.proxiesDir, 'proxies.txt');
  if (!fs.existsSync(proxiesTxt)) {
    fs.writeFileSync(proxiesTxt, PROXIES_TEMPLATE);
    firstRun = true;
  }

  ensureDir(PATHS.ticketmasterDir);
  const exampleCsv = path.join(PATHS.ticketmasterDir, 'example.csv');
  if (!fs.existsSync(exampleCsv)) {
    fs.writeFileSync(exampleCsv, CSV_TEMPLATE);
    firstRun = true;
  }

  ensureDir(PATHS.queueitDir);
  // Placeholder readme dans Queue-it (module a venir)
  const queueitReadme = path.join(PATHS.queueitDir, 'README.txt');
  if (!fs.existsSync(queueitReadme)) {
    fs.writeFileSync(queueitReadme, 'Module Queue-it standalone — a venir.\n');
  }

  return firstRun;
};

export const loadConfig = (): { config: AppConfig; firstRun: boolean } => {
  const firstRun = setupTemplates();

  const raw = fs.readFileSync(PATHS.configJson, 'utf8');
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('config.json invalide (JSON malforme)'); }

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
  };

  return { config, firstRun };
};

export const validateConfig = (config: AppConfig): string[] => {
  const errors: string[] = [];
  if (!config.capsolver_api_key || config.capsolver_api_key.includes('REMPLACER'))
    errors.push('capsolver_api_key manquant dans config.json');
  if (!config.default_webhook_url || config.default_webhook_url.includes('REMPLACER'))
    errors.push('default_webhook_url manquant dans config.json (sera utilise si webhook par tache vide)');
  return errors;
};

// Liste les modules disponibles (dossiers contenant des CSV)
export interface ModuleInfo {
  name: string;
  dir: string;
  taskFiles: string[];
}

export const listModules = (): ModuleInfo[] => {
  const modules: ModuleInfo[] = [];

  // TicketMaster
  if (fs.existsSync(PATHS.ticketmasterDir)) {
    const csvs = fs.readdirSync(PATHS.ticketmasterDir)
      .filter(f => f.toLowerCase().endsWith('.csv'));
    modules.push({
      name: 'TicketMaster',
      dir: PATHS.ticketmasterDir,
      taskFiles: csvs,
    });
  }

  // Queue-it (si des CSV un jour)
  if (fs.existsSync(PATHS.queueitDir)) {
    const csvs = fs.readdirSync(PATHS.queueitDir)
      .filter(f => f.toLowerCase().endsWith('.csv'));
    modules.push({
      name: 'Queue-it',
      dir: PATHS.queueitDir,
      taskFiles: csvs,
    });
  }

  return modules;
};
