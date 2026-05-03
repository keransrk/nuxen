import { HttpClient } from '../utils/http.js';
import { CookieJar } from '../utils/cookieJar.js';
import { generateCookies } from './cookies.js';
import { solveRecaptchaInvisible } from './recaptcha.js';
import { getGrilleTarifaire, pickRandomPlace } from './grilleTarif.js';
import { purchaseInit } from './purchaseInit.js';
import { runQueueIt } from './queueit/index.js';
import { sendDiscordNotification } from './discord.js';
import { sendSession } from './session.js';
import { store, type LogLevel } from './store.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/random.js';
import type { AppConfig } from '../config/loader.js';
import type { EventInfo } from './eventResolver.js';
import type { TmCookies } from './cookies.js';
import type { TaskRow } from '../config/taskCsv.js';

export interface StopSignal {
  stopped: boolean;
}

export const runTask = async (
  taskId: number,
  proxyUrl: string,
  eventInfo: EventInfo,
  config: AppConfig,
  stopSignal: StopSignal,
  row: TaskRow
) => {
  const log = (msg: string, level: LogLevel = 'info') => {
    store.appendLog(taskId, msg, level);
    logger.info(taskId, msg);
  };

  const fail = (err: string) => {
    store.updateTask(taskId, { status: 'error', statusText: err.slice(0, 60), error: err, completedAt: new Date() });
    log(`${err}`, 'error');
  };

  try {
    // ÔöÇÔöÇÔöÇ ├ëTAPE 1: G├®n├®rer les cookies ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    store.updateTask(taskId, { status: 'cookies', statusText: 'G├®n├®ration cookies...' });
    log('Ôæá G├®n├®ration cookies ÔÇö GET /eps-mgr...', 'step');

    let cookies: TmCookies;
    try {
      cookies = await generateCookies(config.capsolver_api_key, proxyUrl, taskId);
    } catch (e: any) {
      return fail(`Cookies: ${e.message}`);
    }

    if (cookies.ok) {
      log('Ô£ô Cookies TM g├®n├®r├®s (eps_sid ┬À SID ┬À BID ┬À tmpt)', 'success');
    } else {
      log('ÔÜá Cookies incomplets ÔÇö certains manquants', 'warn');
    }

    if (stopSignal.stopped) return;

    const tmClient = new HttpClient({ proxyUrl, delayMs: config.request_delay_ms });
    tmClient.cookieJar.ingestString(cookies.cookieString);
    tmClient.cookieJar.set('tkm_i18n', 'fr');

    // ÔöÇÔöÇÔöÇ ├ëTAPE 2: V├®rifier la page ├®v├®nement (Queue-it ├®ventuelle) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    store.updateTask(taskId, { status: 'grille', statusText: 'V├®rification page ├®v├®nement...' });
    log('Ôæí V├®rification page ├®v├®nement (Queue-it?)...', 'step');

    const pageUrl = `https://www.ticketmaster.fr/fr/manifestation/${eventInfo.slug}-billet/idmanif/${eventInfo.idmanif}`;
    let queueItCookie: string | undefined;

    try {
      const pageRes = await tmClient.request({
        method: 'GET',
        url: pageUrl,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        maxRedirects: 0,
      });

      // CAS 1 : redirect HTTP 302 vers queue-it.net (server-side)
      let queueItDetectedUrl: string | null = null;
      if ((pageRes.status === 302 || pageRes.status === 301)) {
        const location: string = pageRes.headers['location'] || '';
        if (location.includes('queue-it.net')) {
          queueItDetectedUrl = location;
          log('ÔÅ│ Queue-it d├®tect├® (redirect 302 sur page ├®v├®nement)', 'queue');
        }
      }

      // CAS 2 : page 200 mais contient une config Queue-it active (client-side JS)
      if (!queueItDetectedUrl && pageRes.status === 200) {
        const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';
        // Queue-it actif c├┤t├® client si la config contient des int├®grations non vides
        // ou si la page est d├®j├á la waiting room Queue-it
        const isQueueItPage = html.includes('queue-it.net') && (
          html.includes('"integrations":[{') ||     // int├®grations actives
          html.includes('data-pageid="queue"') ||   // waiting room Queue-it
          html.includes('data-pageid="before"')     // before queue
        );
        if (isQueueItPage) {
          // Extraire l'URL Queue-it depuis la page ou construire depuis config
          const configMatch = html.match(/queueit_clientside_config\s*=\s*({[\s\S]*?})\s*;/);
          const customerMatch = html.match(/"customerId"\s*:\s*"([^"]+)"/);
          const eventMatch = html.match(/"eventId"\s*:\s*"([^"]+)"/);
          const targetMatch = html.match(/"targetUrl"\s*:\s*decodeURIComponent\('([^']+)'\)/);

          if (customerMatch && eventMatch) {
            const cid = customerMatch[1];
            const eid = eventMatch[1];
            const t = targetMatch ? targetMatch[1] : encodeURIComponent(pageUrl);
            queueItDetectedUrl = `https://${cid}.queue-it.net/?c=${cid}&e=${eid}&t=${t}`;
            log(`ÔÅ│ Queue-it d├®tect├® (HTML client-side, event=${eid})`, 'queue');
          } else {
            log('ÔÅ│ Queue-it probable (scripts d├®tect├®s) ÔÇö attente purchase/init', 'warn');
          }
        }
      }

      if (queueItDetectedUrl) {
        store.updateTask(taskId, { status: 'queued', statusText: 'File Queue-it...', queuePosition: '?' });
        let queueResult: any;
        try {
          queueResult = await runQueueIt(
            queueItDetectedUrl, proxyUrl, config.capsolver_api_key, taskId,
            (update) => {
              const pos = update.queuePosition ?? '?';
              const forecast = update.forecastStatus ?? '';
              store.updateTask(taskId, {
                queuePosition: pos,
                forecastStatus: forecast,
                statusText: `File: ${pos} devant`,
              });
              if (forecast === 'FirstInLine') log('­ƒÅü Premier dans la file!', 'queue');
            },
            stopSignal
          );
        } catch (e: any) {
          return fail(`Queue-it: ${e.message}`);
        }
        if (stopSignal.stopped) return;
        queueItCookie = queueResult.queueItCookie;
        if (queueItCookie) tmClient.cookieJar.ingestString(queueItCookie);
        log('Ô£ô File pass├®e! Acc├¿s accord├®', 'success');
      } else if (pageRes.status === 200) {
        log('Ô£ô Page ├®v├®nement OK ÔÇö pas de Queue-it', 'success');
      }
    } catch (e: any) {
      // Si 200 ou erreur r├®seau non-bloquante, on continue
      if (!String(e.message).includes('Queue-it')) {
        log(`ÔÜá V├®rif. page: ${e.message} ÔÇö on continue`, 'warn');
      } else {
        return fail(`Page ├®v├®nement: ${e.message}`);
      }
    }

    if (stopSignal.stopped) return;

    // ÔöÇÔöÇÔöÇ ├ëTAPE 3: Charger la grille tarifaire ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    store.updateTask(taskId, { status: 'grille', statusText: 'Chargement grille tarifaire...' });
    log('Ôæó Chargement grille tarifaire...', 'step');

    let seances: any[];
    try {
      seances = await getGrilleTarifaire(tmClient, eventInfo.idmanif, taskId, eventInfo.slug);
    } catch (e: any) {
      return fail(`Grille tarifaire: ${e.message}`);
    }

    if (stopSignal.stopped) return;

    // ÔöÇÔöÇÔöÇ ├ëTAPE 4: S├®lection random de place ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    let place: any;
    try {
      place = pickRandomPlace(seances, taskId, {
        priceMin: row.priceMin,
        priceMax: row.priceMax,
        quantityMin: row.quantityMin,
        quantityMax: row.quantityMax,
        section: row.section,
        dates: row.dates,
      });
    } catch (e: any) {
      return fail(`S├®lection place: ${e.message}`);
    }

    log(`Ô£ô S├®ance ${place.idseanc} ÔÇö ${place.llgcatpl} ÔÇö ${place.qty}├ù ${place.price}Ôé¼`, 'success');
    store.updateTask(taskId, { statusText: `${place.llgcatpl} ┬À ${place.qty}├ù ${place.price}Ôé¼` });

    if (stopSignal.stopped) return;

    // ÔöÇÔöÇÔöÇ ├ëTAPE 5: R├®soudre reCAPTCHA invisible ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    store.updateTask(taskId, { status: 'recaptcha', statusText: 'reCAPTCHA invisible...' });
    log('Ôæú reCAPTCHA invisible ÔÇö Capsolver (avec proxy)...', 'step');
    let recaptchaToken: string;
    try {
      recaptchaToken = await solveRecaptchaInvisible(config.capsolver_api_key, taskId, proxyUrl);
    } catch (e: any) {
      return fail(`reCAPTCHA: ${e.message}`);
    }
    log('Ô£ô reCAPTCHA invisible r├®solu', 'success');

    if (stopSignal.stopped) return;

    // ÔöÇÔöÇÔöÇ ├ëTAPE 6: Purchase init ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    store.updateTask(taskId, { status: 'purchase', statusText: 'Cr├®ation du panier...' });
    log('Ôæñ POST /api/purchase/init...', 'step');

    let purchaseResult: any;
    try {
      purchaseResult = await purchaseInit(
        tmClient, eventInfo.idmanif, eventInfo.slug,
        place, recaptchaToken, taskId, queueItCookie,
        row.offerCode,
      );
    } catch (e: any) {
      return fail(`Purchase init: ${e.message}`);
    }

    // ÔöÇÔöÇÔöÇ ├ëTAPE 7: Si Queue-it d├®tect├® ├á purchase (fallback) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    if (purchaseResult.isQueueIt) {
      store.updateTask(taskId, { status: 'queued', statusText: 'File Queue-it (purchase)...', queuePosition: '?' });
      log('ÔÅ│ Queue-it d├®tect├® sur purchase/init ÔÇö bypass...', 'queue');

      let queueResult: any;
      try {
        queueResult = await runQueueIt(
          purchaseResult.queueItUrl, proxyUrl, config.capsolver_api_key, taskId,
          (update) => {
            const pos = update.queuePosition ?? '?';
            const forecast = update.forecastStatus ?? '';
            store.updateTask(taskId, {
              queuePosition: pos,
              forecastStatus: forecast,
              statusText: `File: ${pos} devant`,
            });
            if (forecast === 'FirstInLine') log('­ƒÅü Premier dans la file!', 'queue');
          },
          stopSignal
        );
      } catch (e: any) {
        return fail(`Queue-it: ${e.message}`);
      }

      if (stopSignal.stopped) return;

      queueItCookie = queueResult.queueItCookie;
      log('Ô£ô File pass├®e! 2├¿me tentative purchase/init...', 'success');
      store.updateTask(taskId, { status: 'purchase', statusText: 'Panier (post-queue)...' });

      log('ÔæÑ reCAPTCHA invisible (post-queue)...', 'step');
      try {
        recaptchaToken = await solveRecaptchaInvisible(config.capsolver_api_key, taskId, proxyUrl);
      } catch (e: any) {
        return fail(`reCAPTCHA post-queue: ${e.message}`);
      }
      log('Ô£ô reCAPTCHA r├®solu', 'success');

      log('Ôæª POST /api/purchase/init (post-queue)...', 'step');
      try {
        purchaseResult = await purchaseInit(
          tmClient, eventInfo.idmanif, eventInfo.slug,
          place, recaptchaToken, taskId, queueItCookie,
          row.offerCode,
        );
      } catch (e: any) {
        return fail(`Purchase post-queue: ${e.message}`);
      }

      if (purchaseResult.isQueueIt) return fail('Queue-it re-d├®tect├® ÔÇö abandon');
    }

    // ÔöÇÔöÇÔöÇ ├ëTAPE 7bis: Verification contiguite ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const basket = purchaseResult.basket;
    const firstItem = basket.items?.[0];
    const isContiguous = !firstItem?.warningNoContiguousTickets;

    if (row.acceptContiguous && !isContiguous) {
      return fail('Places non contigu├½s rejet├®es (Accept_Contigous=true)');
    }

    // ÔöÇÔöÇÔöÇ ├ëTAPE 7: Succ├¿s ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    const sub = basket.items?.[0]?.subEventBasketDto?.[0];
    const tickets = sub?.tickets ?? [];
    const seatsStr = tickets.map((t: any) => `${t.llgzone} R${t.rgplac} S${t.numplac}`).join(' ┬À ') || 'Automatique';

    log(`Ô£ô PANIER CR├ë├ë! ID #${basket.id} ÔÇö ${basket.price}Ôé¼${isContiguous ? ' ┬À contigu' : ' ┬À non-contigu'}`, 'success');
    log(`  ${sub?.llgcatpl ?? place.llgcatpl} ┬À ${seatsStr}`, 'success');

    store.updateTask(taskId, {
      status: 'success',
      statusText: `#${basket.id} ÔÇö ${basket.price}Ôé¼`,
      basketId: basket.id,
      price: basket.price,
      category: sub?.llgcatpl ?? place.llgcatpl,
      seats: seatsStr,
      completedAt: new Date(),
    });

    // ÔöÇÔöÇÔöÇ ├ëTAPE 8: Session tm.sdss.fr ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    log('Ôæª Envoi session tm.sdss.fr...', 'step');
    let sessionUrl = `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
    try {
      const sessionResult = await sendSession(basket, cookies, eventInfo, taskId);
      sessionUrl = sessionResult.sessionUrl;
      log(`Ô£ô Session URL: ${sessionUrl.slice(0, 60)}`, 'success');
    } catch (e: any) {
      log(`ÔÜá Session: ${e.message} ÔÇö fallback basket URL`, 'warn');
    }

    // ÔöÇÔöÇÔöÇ ├ëTAPE 9: Notification Discord ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
    log('Ôæº Envoi notification Discord...', 'step');
    const webhookUrl = row.webhook || config.default_webhook_url;
    try {
      await sendDiscordNotification(
        webhookUrl, config.discord_user_id_to_ping,
        basket, cookies, eventInfo,
        store.state.tasks.find(t => t.id === taskId)?.proxyLabel ?? proxyUrl.slice(-8),
        sessionUrl,
        place.dateSeance,
        isContiguous,
      );
      log('Ô£ô Notification Discord envoy├®e', 'success');
    } catch (e: any) {
      log(`ÔÜá Discord: ${e.message}`, 'warn');
    }

  } catch (err: any) {
    fail(err.message ?? 'Erreur inconnue');
  }
};
