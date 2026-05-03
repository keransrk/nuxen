import { HttpClient } from '../utils/http.js';
import { pickRandom, randomInt } from '../utils/random.js';
import { logger } from '../utils/logger.js';

const TM_BASE = 'https://www.ticketmaster.fr';
const PARTNER_ID = '78768';

export interface NatCliTarif {
  idNatCl: number;
  nameNatCl: string;
  price: number;
  min: number;
  max: number;
  increment: number;
  inddispo: boolean;
  contingent: string;
}

export interface Zone {
  idzone: string;
  llczone: string;
  placementcatpl: string;
  nbplaces: number;
}

export interface InfoCategory {
  codCatPl: string;
  llgCatPl: string;
  llcCatPl: string;
  codeTypePlace: string;
  nbPlaces: number;
  priceMin: number;
  priceOrdre: number;
  infoNatCliTarifs: NatCliTarif[];
  zones: Zone[];
}

export interface Seance {
  idseanc: number;
  idmanif: number;
  dateSeance: string;
  hasPlacesDispo: boolean;
  status: string;
  nbPlacesCommandable: number;
  hasZoning: boolean;
  llgseanc: string;
  infoCategories: InfoCategory[] | null;
}

export interface SelectedPlace {
  idseanc: number;
  codcatpl: string;
  llgcatpl: string;
  idNatCl: number;
  natCliQty: Record<string, number>;
  idZone: string | null;
  qty: number;
  price: number;
  dateSeance: string;
}

const TM_HEADERS_BASE = {
  Accept: 'application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Referer: `${TM_BASE}/fr`,
};
void TM_HEADERS_BASE;

export const getGrilleTarifaire = async (
  client: HttpClient,
  idmanif: string,
  taskId: number,
  slug?: string
): Promise<Seance[]> => {
  logger.info(taskId, `GET grille-tarifaire idmanif=${idmanif}...`);

  const pageUrl = slug
    ? `${TM_BASE}/fr/manifestation/${slug}-billet/idmanif/${idmanif}`
    : `${TM_BASE}/fr/manifestation/idmanif/${idmanif}`;

  const url = `${TM_BASE}/api/grille-tarifaire/manifestation/idmanif/${idmanif}/${PARTNER_ID}`
    + `?codLang=FR&codCoMod=WEB&onlyFirstAvailableByDay=false&tokenRecaptchaGoogle=`;

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Referer': pageUrl,
    'Origin': TM_BASE,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  const res = await client.get<Seance[]>(url, { headers });

  if (res.status !== 200) throw new Error(`grille-tarifaire ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);

  const seances: Seance[] = Array.isArray(res.data) ? res.data : [];
  logger.info(taskId, `${seances.length} s├®ance(s) r├®cup├®r├®e(s)`);
  return seances;
};

export const pickRandomPlace = (
  seances: Seance[],
  taskId: number,
  filters: {
    priceMin?: number | null;
    priceMax?: number | null;
    quantityMin?: number | null;
    quantityMax?: number | null;
    section?: string | null;
    dates?: string[];
  }
): SelectedPlace => {
  // Filtre dates si specifie
  let available = seances.filter(
    s => s.hasPlacesDispo && s.status === 'D' && Array.isArray(s.infoCategories)
  );

  if (filters.dates && filters.dates.length > 0) {
    // Import dynamique evite cycle
    const { matchesDateFilter } = require('../config/taskCsv.js') as typeof import('../config/taskCsv.js');
    available = available.filter(s => matchesDateFilter(s.dateSeance, filters.dates!));
    if (available.length === 0) {
      throw new Error(`Aucune s├®ance disponible pour les dates: ${filters.dates.join(', ')}`);
    }
  }

  if (available.length === 0) throw new Error('Aucune s├®ance disponible (hasPlacesDispo = false ou complet)');

  const seance = pickRandom(available);

  // Filtre categories
  let cats = seance.infoCategories!.filter(
    c => c.nbPlaces > 0 && Array.isArray(c.infoNatCliTarifs)
  );

  // Filtre par section si specifie (match codCatPl ou llgCatPl)
  if (filters.section) {
    const sec = filters.section.toLowerCase();
    const filtered = cats.filter(c =>
      c.codCatPl?.toLowerCase().includes(sec) ||
      c.llgCatPl?.toLowerCase().includes(sec) ||
      c.llcCatPl?.toLowerCase().includes(sec)
    );
    if (filtered.length === 0) {
      throw new Error(`Section "${filters.section}" introuvable dans cette s├®ance`);
    }
    cats = filtered;
  }

  // Filtre par prix (sur priceMin de la categorie)
  if (filters.priceMin != null || filters.priceMax != null) {
    const filtered = cats.filter(c => {
      const p = c.priceMin;
      if (filters.priceMin != null && p < filters.priceMin) return false;
      if (filters.priceMax != null && p > filters.priceMax) return false;
      return true;
    });
    if (filtered.length === 0) {
      throw new Error(`Aucune cat├®gorie dans la fourchette de prix [${filters.priceMin ?? 'ÔêÆÔê×'}Ôé¼ ÔÇö ${filters.priceMax ?? '+Ôê×'}Ôé¼]`);
    }
    cats = filtered;
  }

  if (cats.length === 0) throw new Error('Aucune cat├®gorie avec des places disponibles');

  const cat = pickRandom(cats);

  const tarif =
    cat.infoNatCliTarifs.find(t => t.idNatCl === 1 && t.inddispo) ??
    cat.infoNatCliTarifs.find(t => t.inddispo);

  if (!tarif) throw new Error(`Aucun tarif disponible dans ${cat.llgCatPl}`);

  // Quantites: respecter les limites du tarif + filtres CSV
  // Si CSV vide ÔåÆ fenetre random au-dessus/dessous de l'autre
  let qMin = filters.quantityMin ?? null;
  let qMax = filters.quantityMax ?? null;
  if (qMin == null && qMax != null) qMin = Math.max(tarif.min, 1);
  if (qMax == null && qMin != null) qMax = Math.min(tarif.max, qMin + 2);
  if (qMin == null && qMax == null) { qMin = tarif.min; qMax = Math.min(tarif.max, 2); }

  const minQty = Math.max(tarif.min, qMin!);
  const maxQty = Math.min(tarif.max, qMax!);
  const qty = minQty <= maxQty ? randomInt(minQty, maxQty) : tarif.min;

  logger.info(
    taskId,
    `S├®lection: s├®ance ${seance.idseanc} | cat ${cat.llgCatPl} | ${qty}x ${tarif.nameNatCl} ├á ${tarif.price}Ôé¼`
  );

  return {
    idseanc: seance.idseanc,
    codcatpl: cat.codCatPl,
    llgcatpl: cat.llgCatPl,
    idNatCl: tarif.idNatCl,
    natCliQty: { [tarif.idNatCl]: qty },
    idZone: null,
    qty,
    price: tarif.price,
    dateSeance: seance.dateSeance,
  };
};
