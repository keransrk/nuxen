import axios from 'axios';
import type { BasketResult } from './purchaseInit.js';
import type { TmCookies } from './cookies.js';
import type { EventInfo } from './eventResolver.js';

const NUXEN_COLOR = 0x7C3AED;

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
  const title = item?.title ?? 'Evenement';

  const placesDesc = tickets.length > 0
    ? tickets.map(t => `**${t.llgzone}** \u2014 Rang ${t.rgplac} Si\u00e8ge ${t.numplac} (${t.llcsect})`).join('\n')
    : 'Non num\u00e9rot\u00e9 / automatique';

  const eventDateIso = item?.startDate || seanceDateIso || null;
  const eventDateStr = formatDate(eventDateIso);

  const cartCreatedAt = new Date(basket.date);
  const expiresAt = basket.expirationDate
    ? new Date(basket.expirationDate)
    : new Date(cartCreatedAt.getTime() + 8 * 60 * 1000);
  const expiresStr = formatTime(expiresAt.toISOString());

  const contiguousFlag = isContiguous ?? !item?.warningNoContiguousTickets;
  const contiguous = contiguousFlag
    ? '\u2705 Contigu\u00ebs'
    : '\u26a0\ufe0f Non contigu\u00ebs';

  const openUrl = sessionUrl || `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
  const ping = userIdToPing ? `<@${userIdToPing}> ` : '';

  const content = `${ping}\ud83c\udfaf **PANIER CR\u00c9\u00c9 \u2014 ${title}**\n\ud83d\udd17 **${openUrl}**`;

  const embed = {
    title: `\u2705 Panier #${basket.id} \u2014 ${basket.price}\u20ac`,
    color: NUXEN_COLOR,
    description: `[\ud83c\udfab Ouvrir le panier (expire \u00e0 ${expiresStr})](${openUrl})`,
    fields: [
      { name: '\ud83c\udfb5 Artiste',          value: title,                          inline: true },
      { name: '\ud83c\udf10 Proxy',             value: proxyLabel,                     inline: true },
      { name: '\ud83d\udcb0 Prix total',         value: `**${basket.price}\u20ac**`,    inline: true },
      { name: '\ud83d\udcc5 Date \u00e9v\u00e9nement', value: eventDateStr,            inline: false },
      { name: '\u23f1\ufe0f Expiration panier', value: expiresStr,                     inline: true },
      { name: '\ud83c\udfaf Cat\u00e9gorie',    value: sub?.llgcatpl ?? 'N/A',         inline: true },
      { name: '\ud83d\udd22 Quantit\u00e9',     value: String(tickets.length || 1),    inline: true },
      { name: '\ud83d\udcba Places',             value: placesDesc,                     inline: false },
      { name: '\ud83d\udd17 Contigu\u00ebs',    value: contiguous,                     inline: true },
      { name: '\ud83d\uded2 Basket ID',         value: String(basket.id),              inline: true },
      { name: '\ud83d\udd17 URL Panier',        value: openUrl,                        inline: false },
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
