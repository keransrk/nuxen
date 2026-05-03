import fs from 'fs';

export type TaskMode = 'Drop' | 'Queue_pass' | 'White_pass';

export interface TaskRow {
  rowIndex: number;
  mode: TaskMode;
  url: string;
  priceMin: number | null;
  priceMax: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  proxyFile: string;
  acceptContiguous: boolean;
  section: string | null;
  offerCode: string | null;
  dates: string[];
  webhook: string | null;
}

export interface ParsedTaskFile {
  rows: TaskRow[];
  errors: { row: number; message: string }[];
}

const REQUIRED_COLUMNS = [
  'Mode', 'Url', 'Price_min', 'Price_max', 'Quantity_min', 'Quantity_max',
  'Proxy_File', 'Accept_Contigous', 'Section', 'Offer_Code', 'Dates', 'Webhook',
];

const splitCsvLine = (line: string): string[] => {
  // Simple split par virgule (suffisant pour le format actuel sans guillemets imbriques)
  // Si besoin futur : parser plus robuste avec gestion des guillemets
  return line.split(',').map(s => s.trim());
};

const parseInt0 = (v: string): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
};

const parseFloat0 = (v: string): number | null => {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const parseBool = (v: string): boolean => {
  const lower = v.toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'oui';
};

const parseDates = (v: string): string[] => {
  if (!v) return [];
  // Supporte des dates separees par ; ou |
  return v.split(/[;|]/).map(s => s.trim()).filter(Boolean);
};

export const parseTaskCsv = (filePath: string): ParsedTaskFile => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));

  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'Fichier CSV vide' }] };
  }

  const header = splitCsvLine(lines[0]);
  const missingCols = REQUIRED_COLUMNS.filter(c => !header.includes(c));
  if (missingCols.length > 0) {
    return {
      rows: [],
      errors: [{ row: 0, message: `Colonnes manquantes: ${missingCols.join(', ')}` }],
    };
  }

  const colIdx: Record<string, number> = {};
  REQUIRED_COLUMNS.forEach(c => { colIdx[c] = header.indexOf(c); });

  const rows: TaskRow[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (col: string) => (cells[colIdx[col]] ?? '').trim();

    const url = get('Url');
    const proxyFile = get('Proxy_File');
    const modeStr = get('Mode') || 'Drop';

    // Validation: Url et Proxy_File obligatoires
    if (!url) {
      errors.push({ row: i + 1, message: 'Url vide ÔÇö tache ignoree' });
      continue;
    }
    if (!proxyFile) {
      errors.push({ row: i + 1, message: 'Proxy_File vide ÔÇö tache ignoree' });
      continue;
    }

    const validModes: TaskMode[] = ['Drop', 'Queue_pass', 'White_pass'];
    const mode = validModes.includes(modeStr as TaskMode) ? (modeStr as TaskMode) : 'Drop';

    rows.push({
      rowIndex: i + 1,
      mode,
      url,
      priceMin: parseFloat0(get('Price_min')),
      priceMax: parseFloat0(get('Price_max')),
      quantityMin: parseInt0(get('Quantity_min')),
      quantityMax: parseInt0(get('Quantity_max')),
      proxyFile,
      acceptContiguous: parseBool(get('Accept_Contigous')),
      section: get('Section') || null,
      offerCode: get('Offer_Code') || null,
      dates: parseDates(get('Dates')),
      webhook: get('Webhook') || null,
    });
  }

  return { rows, errors };
};

// Convertit "13/11/2026" ÔåÆ date object pour comparaison avec dateSeance ISO
export const parseFrenchDate = (s: string): Date | null => {
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
};

export const matchesDateFilter = (dateSeanceIso: string, dates: string[]): boolean => {
  if (dates.length === 0) return true; // pas de filtre
  const seance = new Date(dateSeanceIso);
  for (const d of dates) {
    const target = parseFrenchDate(d);
    if (!target) continue;
    if (seance.getFullYear() === target.getFullYear() &&
        seance.getMonth() === target.getMonth() &&
        seance.getDate() === target.getDate()) {
      return true;
    }
  }
  return false;
};
