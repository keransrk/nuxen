import axios from 'axios';
import type { BasketResult } from './purchaseInit.js';
import type { TmCookies } from './cookies.js';
import type { EventInfo } from './eventResolver.js';

const NUXEN_COLOR = 0x7C3AED; // violet

const formatDate = (iso: string | null | undefined, fallback = 'N/A'): string => {
  if (!iso) return fallback;
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return fallback;
  }
};

const formatTime = (iso: string | null | undefined): string => {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return 'N/A';
  }
};

export const sendDiscordNotification = async (
  webhookUrl: string,
  userIdToPing: string,
  basket: BasketResult,
  cookies: TmCookies,
  eventInfo: EventInfo,
  proxyLabel: string,
  sessionUrl?: string,
  seanceDateIso?: string,
  isContiguous?: boolean,
) => {
  if (!webhookUrl || !webhookUrl.includes('discord.com/api/webhooks')) return;

  const item = basket.items?.[0];
  const sub = item?.subEventBasketDto?.[0];
  const tickets = sub?.tickets ?? [];
  const title = item?.title ?? '├ëv├®nement';

  // Places description
  const placesDesc = tickets.length > 0
    ? tickets.map(t => `**${t.llgzone}** ÔÇö Rang ${t.rgplac} Si├¿ge ${t.numplac} (${t.llcsect})`).join('\n')
    : 'Non num├®rot├® / automatique';

  // Date de l'├®v├®nement (startDate du basket ou dateSeance de la grille tarifaire)
  const eventDateIso = item?.startDate || seanceDateIso || null;
  const eventDateStr = formatDate(eventDateIso);

  // Expiration du panier (TM = 8 minutes apr├¿s cr├®ation)
  const cartCreatedAt = new Date(basket.date);
  const expiresAt = basket.expirationDate
    ? new Date(basket.expirationDate)
    : new Date(cartCreatedAt.getTime() + 8 * 60 * 1000);
  const expiresStr = formatTime(expiresAt.toISOString());

  // Contigu├½ (override par parametre, sinon depuis basket)
  const contiguousFlag = isContiguous ?? !item?.warningNoContiguousTickets;
  const contiguous = contiguousFlag ? 'Ô£ô Contigu├½s' : 'ÔÜá Non contigu├½s';

  const openUrl = sessionUrl || `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
  const ping = userIdToPing ? `<@${userIdToPing}> ` : '';
  const content = `${ping}­ƒÄƒ´©Å **PANIER CR├ë├ë ÔÇö ${title}**\n­ƒöù **${openUrl}**`;

  const embed = {
    title: `Ô£à Panier #${basket.id} ÔÇö ${basket.price}Ôé¼`,
    color: NUXEN_COLOR,
    description: `[­ƒæë Ouvrir le panier (expire ├á ${expiresStr})](${openUrl})`,
    fields: [
      { name: '­ƒÄÁ Artiste', value: title, inline: true },
      { name: '­ƒîÉ Proxy', value: proxyLabel, inline: true },
      { name: '­ƒÆÂ Prix total', value: `**${basket.price}Ôé¼**`, inline: true },
      { name: '­ƒôà Date ├®v├®nement', value: eventDateStr, inline: false },
      { name: 'ÔÅ░ Expiration panier', value: expiresStr, inline: true },
      { name: '­ƒÄƒ´©Å Cat├®gorie', value: sub?.llgcatpl ?? 'N/A', inline: true },
      { name: '­ƒöó Quantit├®', value: String(tickets.length || 1), inline: true },
      { name: '­ƒ¬æ Places', value: placesDesc, inline: false },
      { name: '­ƒöù Contigu├½s', value: contiguous, inline: true },
      { name: '­ƒåö Basket ID', value: String(basket.id), inline: true },
      { name: '­ƒöù URL Panier', value: openUrl, inline: false },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NUXEN Bot' },
  };

  const res = await axios.post(`${webhookUrl}?wait=true`, {
    username: 'NUXEN',
    content,
    embeds: [embed],
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    throw new Error(`Discord ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  }
};
