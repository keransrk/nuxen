import { HttpClient } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import type { SelectedPlace } from './grilleTarif.js';

const TM_BASE = 'https://www.ticketmaster.fr';
const PARTNER_ID = '78768';

export interface Ticket {
  idtrs: number;
  llgzone: string;
  llcsect: string;
  rgplac: string;
  numplac: string;
  refzone: string;
  refgrpe: string;
  codtyppl: string;
  llctyppl: string;
  x: number;
  y: number;
}

export interface SubEventBasket {
  codcatpl: string;
  llgcatpl: string;
  idnatcli: number;
  idconf: number;
  numerote: boolean;
  price: number;
  tickets: Ticket[];
}

export interface BasketItem {
  idseanc: number;
  idmanif: number;
  title: string;
  startDate: string | null;
  warningNoContiguousTickets: boolean;
  subEventBasketDto: SubEventBasket[];
}

export interface BasketResult {
  id: number;
  date: string;
  expirationDate?: string | null;
  type: string;
  price: number;
  items: BasketItem[];
}

export interface PurchaseResult {
  basket: BasketResult;
  isQueueIt: false;
}

export interface QueueItResult {
  isQueueIt: true;
  queueItUrl: string;
  location: string;
}

export const purchaseInit = async (
  client: HttpClient,
  idmanif: string,
  slug: string,
  place: SelectedPlace,
  recaptchaToken: string,
  taskId: number,
  queueItCookie?: string
): Promise<PurchaseResult | QueueItResult> => {
  const url = `${TM_BASE}/api/purchase/init/manifestation/idmanif/${idmanif}?tarifPromoPartner=false`;
  const pageUrl = `${TM_BASE}/fr/manifestation/${slug}-billet/idmanif/${idmanif}`;

  const headers: Record<string, string> = {
    'Accept': '*/*',
    'Accept-Language': 'fr-FR',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Origin': TM_BASE,
    'Referer': pageUrl,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-queueit-ajaxpageurl': encodeURIComponent(pageUrl),
  };

  // Inject QueueIT cookie if we have one
  if (queueItCookie) {
    const existing = client.cookieJar.toString();
    headers['Cookie'] = `${existing}; ${queueItCookie}`;
  }

  const body = {
    idTiers: parseInt(PARTNER_ID),
    idManif: parseInt(idmanif),
    idSeance: place.idseanc,
    limite: false,
    subOrderRequestDto: [
      {
        idZone: place.idZone,
        codmodco: 'WEB',
        codcatpl: place.codcatpl,
        natCliQty: place.natCliQty,
        type: 'EVENT_BASKET',
        secondMarket: false,
      },
    ],
    type: 'EVENT_BASKET',
    secondMarket: false,
    hasbilletCollector: false,
    tokenRecaptchaGoogle: recaptchaToken,
    seanceUpsellsDtos: [],
  };

  logger.info(taskId, `POST purchase/init idmanif=${idmanif} séance=${place.idseanc} cat=${place.codcatpl}...`);

  const res = await client.request({
    method: 'POST',
    url,
    headers,
    data: JSON.stringify(body),
    maxRedirects: 0,
  });

  // ─── Queue-it redirect ─────────────────────────────────────────────────────
  if (res.status === 302 || res.status === 301) {
    const location: string = res.headers['location'] || '';
    if (location.includes('queue-it.net')) {
      logger.queue(taskId, `Queue-it détecté! Redirection vers: ${location.slice(0, 80)}...`);
      return { isQueueIt: true, queueItUrl: location, location };
    }
    throw new Error(`Redirection inattendue: ${res.status} → ${location}`);
  }

  // ─── Success ───────────────────────────────────────────────────────────────
  if (res.status === 200) {
    const basket = res.data as BasketResult;
    if (!basket?.id) throw new Error(`purchase/init 200 mais pas de basket id: ${JSON.stringify(res.data).slice(0, 300)}`);
    logger.success(taskId, `Panier créé! id=${basket.id} prix=${basket.price}€`);
    return { basket, isQueueIt: false };
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  throw new Error(`purchase/init ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
};
