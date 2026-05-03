import axios from 'axios';
import type { BasketResult } from './purchaseInit.js';
import type { TmCookies } from './cookies.js';
import type { EventInfo } from './eventResolver.js';
import { logger } from '../utils/logger.js';

const SESSION_URL = 'https://tm.sdss.fr/session';
const PARTNER_ID = 78768;

export interface SessionResult {
  sessionUrl: string;
  basketUrl: string;
}

export const sendSession = async (
  basket: BasketResult,
  cookies: TmCookies,
  eventInfo: EventInfo,
  taskId: number
): Promise<SessionResult> => {
  const cookieMap: Record<string, string> = {};
  cookies.cookieString.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx < 0) return;
    cookieMap[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
  });

  const cookiesPayload = [
    { Name: 'BID',     Value: cookieMap['BID']     || '', Path: '/', Domain: '.epsf.ticketmaster.com', Secure: true,  HttpOnly: true  },
    { Name: 'SID',     Value: cookieMap['SID']     || '', Path: '/', Domain: '.epsf.ticketmaster.com', Secure: true,  HttpOnly: true  },
    { Name: 'tmpt',    Value: cookieMap['tmpt']    || '', Path: '/', Domain: 'ticketmaster.fr',        Secure: false, HttpOnly: false },
    { Name: 'eps_sid', Value: cookieMap['eps_sid'] || '', Path: '/', Domain: 'ticketmaster.fr',        Secure: false, HttpOnly: false },
  ];

  const urlEvent = `/fr/manifestation/${eventInfo.slug}-billet/idmanif/${eventInfo.idmanif}`;

  const basketData = {
    id: basket.id,
    date: basket.date,
    type: basket.type,
    price: basket.price,
    totalPriceTtc: basket.price,
    idTiers: PARTNER_ID,
    donations: [], products: [], fees: [], options: [], optionsSelected: [],
    upsells: [], seanceUpsellsDtos: [],
    modeLivraison: {},
    modePaiement: { onlyOnePaymentMode: false },
    modePaiements: [],
    montantLivraisonAmount: 0,
    firstPurchase: false,
    specialTicket: false,
    optinSpecialTicket: false,
    cancelInsuranceSelected: false,
    idsMandatoryUpsells: [],
    elligibleResell: false,
    billetcollector: { amount: 0 },
    abonnement: { seances: [] },
    items: (basket.items ?? []).map(item => ({
      idmanif: item.idmanif,
      idseanc: item.idseanc,
      title: item.title || '',
      image: null,
      startDate: null,
      city: '', place: '', placeId: 0,
      artisteId: 0, artisteName: '',
      urlEvent,
      placementCart: true,
      hasManySeance: false,
      afficheDateSeance: true,
      showTime: true,
      hasResell: false,
      resell: false,
      isUpsell: false,
      isObligatory: false,
      openPass: false,
      mandatoryAddress: false,
      beneficiarySeizure: false,
      hasBilletcollector: false,
      codgenre: '', codssgenre: '', llggenre: '', llgssgen: '',
      origin: 'AUTO',
      basketPlan: '',
      subEventBasketDto: (item.subEventBasketDto ?? []).map(sub => ({
        codcatpl: sub.codcatpl,
        llgcatpl: sub.llgcatpl,
        idnatcli: sub.idnatcli,
        llgnatcli: null,
        numerote: sub.numerote,
        price: sub.price,
        pricePlace: sub.price,
        prestas: [],
        tickets: (sub.tickets ?? []).map(t => ({
          idtrs: t.idtrs,
          x: t.x, y: t.y,
          llgzone: t.llgzone,
          llcsect: t.llcsect,
          rgplac: t.rgplac,
          numplac: t.numplac,
          codtyppl: t.codtyppl,
          llctyppl: t.llctyppl,
          refzone: t.refzone,
          refgrpe: t.refgrpe,
          frsrevte: null,
          automatique: true,
          expanded: true,
          hasZoning: false,
          isOfferPartenaire: false,
          isSoldout: false,
          groups: [], zones: [],
          dateSeance: basket.date,
          afficheDateSeance: true,
        })),
      })),
    })),
  };

  const payload = {
    cookies: cookiesPayload,
    sessionStorage: {
      [`basket_${PARTNER_ID}`]: basketData,
    },
  };

  logger.info(taskId, 'POST tm.sdss.fr/session...');

  const res = await axios.post(SESSION_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    validateStatus: () => true,
  });

  let sessionUrl = '';
  if (res.status === 200 || res.status === 201) {
    // La r├®ponse peut ├¬tre une URL directe ou un objet { url, id, ... }
    if (typeof res.data === 'string' && res.data.startsWith('http')) {
      sessionUrl = res.data;
    } else if (typeof res.data === 'object') {
      sessionUrl = res.data.url || res.data.sessionUrl || res.data.link || '';
      // Si l'objet a un id, construire l'URL
      if (!sessionUrl && res.data.id) {
        sessionUrl = `${SESSION_URL}/${res.data.id}`;
      }
    }
  }

  if (!sessionUrl) {
    // Fallback : URL panier standard TM
    logger.warn(taskId, `tm.sdss.fr/session status=${res.status}, fallback basket URL`);
    sessionUrl = `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
  } else {
    logger.success(taskId, `Session cr├®├®e: ${sessionUrl}`);
  }

  const basketUrl = `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
  return { sessionUrl, basketUrl };
};
