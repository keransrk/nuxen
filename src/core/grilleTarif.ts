import { HttpClient } from '../utils/http.js';
import { pickRandom, randomInt } from '../utils/random.js';
import { logger } from '../utils/logger.js';
import type { AppConfig } from '../config/loader.js';

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

const TM_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Referer: `${TM_BASE}/fr`,
  'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

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
  logger.info(taskId, `${seances.length} séance(s) récupérée(s)`);
  return seances;
};

export const pickRandomPlace = (
  seances: Seance[],
  config: AppConfig,
  taskId: number
): SelectedPlace => {
  // Filter available seances
  const available = seances.filter(
    s => s.hasPlacesDispo && s.status === 'D' && Array.isArray(s.infoCategories)
  );

  if (available.length === 0) throw new Error('Aucune séance disponible (hasPlacesDispo = false ou complet)');

  const seance = pickRandom(available);

  // Filter categories with available places, prefer standard (idNatCl=1 = TARIF NORMAL)
  const cats = seance.infoCategories!.filter(
    c => c.nbPlaces > 0 && Array.isArray(c.infoNatCliTarifs)
  );

  if (cats.length === 0) throw new Error('Aucune catégorie avec des places disponibles');

  const cat = pickRandom(cats);

  // Prefer idNatCl=1 (TARIF NORMAL), fallback to first available
  const tarif =
    cat.infoNatCliTarifs.find(t => t.idNatCl === 1 && t.inddispo) ??
    cat.infoNatCliTarifs.find(t => t.inddispo);

  if (!tarif) throw new Error(`Aucun tarif disponible dans ${cat.llgCatPl}`);

  const maxQty = Math.min(tarif.max, config.qty_max);
  const minQty = Math.max(tarif.min, config.qty_min);
  const qty = minQty <= maxQty ? randomInt(minQty, maxQty) : tarif.min;

  logger.info(
    taskId,
    `Sélection: séance ${seance.idseanc} | cat ${cat.llgCatPl} | ${qty}x ${tarif.nameNatCl} à ${tarif.price}€`
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
