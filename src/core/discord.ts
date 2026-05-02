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
) => {
  if (!webhookUrl || !webhookUrl.includes('discord.com/api/webhooks')) return;

  const item = basket.items?.[0];
  const sub = item?.subEventBasketDto?.[0];
  const tickets = sub?.tickets ?? [];
  const title = item?.title ?? 'Événement';

  // Places description
  const placesDesc = tickets.length > 0
    ? tickets.map(t => `**${t.llgzone}** — Rang ${t.rgplac} Siège ${t.numplac} (${t.llcsect})`).join('\n')
    : 'Non numéroté / automatique';

  // Date de l'événement (startDate du basket ou dateSeance de la grille tarifaire)
  const eventDateIso = item?.startDate || seanceDateIso || null;
  const eventDateStr = formatDate(eventDateIso);

  // Expiration du panier (TM = 8 minutes après création)
  const cartCreatedAt = new Date(basket.date);
  const expiresAt = basket.expirationDate
    ? new Date(basket.expirationDate)
    : new Date(cartCreatedAt.getTime() + 8 * 60 * 1000);
  const expiresStr = formatTime(expiresAt.toISOString());

  // Contiguë
  const contiguous = item?.warningNoContiguousTickets === true ? '⚠ Non contiguës' : '✓ Contiguës';

  const openUrl = sessionUrl || `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
  const ping = userIdToPing ? `<@${userIdToPing}> ` : '';
  const content = `${ping}🎟️ **PANIER CRÉÉ — ${title}**\n🔗 **${openUrl}**`;

  const embed = {
    title: `✅ Panier #${basket.id} — ${basket.price}€`,
    color: NUXEN_COLOR,
    description: `[👉 Ouvrir le panier (expire à ${expiresStr})](${openUrl})`,
    fields: [
      { name: '🎵 Artiste', value: title, inline: true },
      { name: '🌐 Proxy', value: proxyLabel, inline: true },
      { name: '💶 Prix total', value: `**${basket.price}€**`, inline: true },
      { name: '📅 Date événement', value: eventDateStr, inline: false },
      { name: '⏰ Expiration panier', value: expiresStr, inline: true },
      { name: '🎟️ Catégorie', value: sub?.llgcatpl ?? 'N/A', inline: true },
      { name: '🔢 Quantité', value: String(tickets.length || 1), inline: true },
      { name: '🪑 Places', value: placesDesc, inline: false },
      { name: '🔗 Contiguës', value: contiguous, inline: true },
      { name: '🆔 Basket ID', value: String(basket.id), inline: true },
      { name: '🔗 URL Panier', value: openUrl, inline: false },
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
