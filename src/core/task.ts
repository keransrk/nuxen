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

export interface StopSignal {
  stopped: boolean;
}

export const runTask = async (
  taskId: number,
  proxyUrl: string,
  eventInfo: EventInfo,
  config: AppConfig,
  stopSignal: StopSignal
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
    // ─── ÉTAPE 1: Générer les cookies ─────────────────────────────────────────
    store.updateTask(taskId, { status: 'cookies', statusText: 'Génération cookies...' });
    log('① Génération cookies — GET /eps-mgr...', 'step');

    let cookies: TmCookies;
    try {
      cookies = await generateCookies(config.capsolver_api_key, proxyUrl, taskId);
    } catch (e: any) {
      return fail(`Cookies: ${e.message}`);
    }

    if (cookies.ok) {
      log('✓ Cookies TM générés (eps_sid · SID · BID · tmpt)', 'success');
    } else {
      log('⚠ Cookies incomplets — certains manquants', 'warn');
    }

    if (stopSignal.stopped) return;

    const tmClient = new HttpClient({ proxyUrl, delayMs: config.request_delay_ms });
    tmClient.cookieJar.ingestString(cookies.cookieString);
    tmClient.cookieJar.set('tkm_i18n', 'fr');

    // ─── ÉTAPE 2: Vérifier la page événement (Queue-it éventuelle) ────────────
    store.updateTask(taskId, { status: 'grille', statusText: 'Vérification page événement...' });
    log('② Vérification page événement (Queue-it?)...', 'step');

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
          log('⏳ Queue-it détecté (redirect 302 sur page événement)', 'queue');
        }
      }

      // CAS 2 : page 200 mais contient une config Queue-it active (client-side JS)
      if (!queueItDetectedUrl && pageRes.status === 200) {
        const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';
        // Queue-it actif côté client si la config contient des intégrations non vides
        // ou si la page est déjà la waiting room Queue-it
        const isQueueItPage = html.includes('queue-it.net') && (
          html.includes('"integrations":[{') ||     // intégrations actives
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
            log(`⏳ Queue-it détecté (HTML client-side, event=${eid})`, 'queue');
          } else {
            log('⏳ Queue-it probable (scripts détectés) — attente purchase/init', 'warn');
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
              if (forecast === 'FirstInLine') log('🏁 Premier dans la file!', 'queue');
            },
            stopSignal
          );
        } catch (e: any) {
          return fail(`Queue-it: ${e.message}`);
        }
        if (stopSignal.stopped) return;
        queueItCookie = queueResult.queueItCookie;
        if (queueItCookie) tmClient.cookieJar.ingestString(queueItCookie);
        log('✓ File passée! Accès accordé', 'success');
      } else if (pageRes.status === 200) {
        log('✓ Page événement OK — pas de Queue-it', 'success');
      }
    } catch (e: any) {
      // Si 200 ou erreur réseau non-bloquante, on continue
      if (!String(e.message).includes('Queue-it')) {
        log(`⚠ Vérif. page: ${e.message} — on continue`, 'warn');
      } else {
        return fail(`Page événement: ${e.message}`);
      }
    }

    if (stopSignal.stopped) return;

    // ─── ÉTAPE 3: Charger la grille tarifaire ────────────────────────────────
    store.updateTask(taskId, { status: 'grille', statusText: 'Chargement grille tarifaire...' });
    log('③ Chargement grille tarifaire...', 'step');

    let seances: any[];
    try {
      seances = await getGrilleTarifaire(tmClient, eventInfo.idmanif, taskId, eventInfo.slug);
    } catch (e: any) {
      return fail(`Grille tarifaire: ${e.message}`);
    }

    if (stopSignal.stopped) return;

    // ─── ÉTAPE 4: Sélection random de place ──────────────────────────────────
    let place: any;
    try {
      place = pickRandomPlace(seances, config, taskId);
    } catch (e: any) {
      return fail(`Sélection place: ${e.message}`);
    }

    log(`✓ Séance ${place.idseanc} — ${place.llgcatpl} — ${place.qty}× ${place.price}€`, 'success');
    store.updateTask(taskId, { statusText: `${place.llgcatpl} · ${place.qty}× ${place.price}€` });

    if (stopSignal.stopped) return;

    // ─── ÉTAPE 5: Résoudre reCAPTCHA invisible ────────────────────────────────
    store.updateTask(taskId, { status: 'recaptcha', statusText: 'reCAPTCHA invisible...' });
    log('④ reCAPTCHA invisible — Capsolver (avec proxy)...', 'step');
    let recaptchaToken: string;
    try {
      recaptchaToken = await solveRecaptchaInvisible(config.capsolver_api_key, taskId, proxyUrl);
    } catch (e: any) {
      return fail(`reCAPTCHA: ${e.message}`);
    }
    log('✓ reCAPTCHA invisible résolu', 'success');

    if (stopSignal.stopped) return;

    // ─── ÉTAPE 6: Purchase init ────────────────────────────────────────────────
    store.updateTask(taskId, { status: 'purchase', statusText: 'Création du panier...' });
    log('⑤ POST /api/purchase/init...', 'step');

    let purchaseResult: any;
    try {
      purchaseResult = await purchaseInit(
        tmClient, eventInfo.idmanif, eventInfo.slug,
        place, recaptchaToken, taskId, queueItCookie,
      );
    } catch (e: any) {
      return fail(`Purchase init: ${e.message}`);
    }

    // ─── ÉTAPE 7: Si Queue-it détecté à purchase (fallback) ───────────────────
    if (purchaseResult.isQueueIt) {
      store.updateTask(taskId, { status: 'queued', statusText: 'File Queue-it (purchase)...', queuePosition: '?' });
      log('⏳ Queue-it détecté sur purchase/init — bypass...', 'queue');

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
            if (forecast === 'FirstInLine') log('🏁 Premier dans la file!', 'queue');
          },
          stopSignal
        );
      } catch (e: any) {
        return fail(`Queue-it: ${e.message}`);
      }

      if (stopSignal.stopped) return;

      queueItCookie = queueResult.queueItCookie;
      log('✓ File passée! 2ème tentative purchase/init...', 'success');
      store.updateTask(taskId, { status: 'purchase', statusText: 'Panier (post-queue)...' });

      log('⑥ reCAPTCHA invisible (post-queue)...', 'step');
      try {
        recaptchaToken = await solveRecaptchaInvisible(config.capsolver_api_key, taskId, proxyUrl);
      } catch (e: any) {
        return fail(`reCAPTCHA post-queue: ${e.message}`);
      }
      log('✓ reCAPTCHA résolu', 'success');

      log('⑦ POST /api/purchase/init (post-queue)...', 'step');
      try {
        purchaseResult = await purchaseInit(
          tmClient, eventInfo.idmanif, eventInfo.slug,
          place, recaptchaToken, taskId, queueItCookie,
        );
      } catch (e: any) {
        return fail(`Purchase post-queue: ${e.message}`);
      }

      if (purchaseResult.isQueueIt) return fail('Queue-it re-détecté — abandon');
    }

    // ─── ÉTAPE 7: Succès ───────────────────────────────────────────────────────
    const basket = purchaseResult.basket;
    const sub = basket.items?.[0]?.subEventBasketDto?.[0];
    const tickets = sub?.tickets ?? [];
    const seatsStr = tickets.map((t: any) => `${t.llgzone} R${t.rgplac} S${t.numplac}`).join(' · ') || 'Automatique';

    log(`✓ PANIER CRÉÉ! ID #${basket.id} — ${basket.price}€`, 'success');
    log(`  ${sub?.llgcatpl ?? place.llgcatpl} · ${seatsStr}`, 'success');

    store.updateTask(taskId, {
      status: 'success',
      statusText: `#${basket.id} — ${basket.price}€`,
      basketId: basket.id,
      price: basket.price,
      category: sub?.llgcatpl ?? place.llgcatpl,
      seats: seatsStr,
      completedAt: new Date(),
    });

    // ─── ÉTAPE 8: Session tm.sdss.fr ──────────────────────────────────────────
    log('⑦ Envoi session tm.sdss.fr...', 'step');
    let sessionUrl = `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
    try {
      const sessionResult = await sendSession(basket, cookies, eventInfo, taskId);
      sessionUrl = sessionResult.sessionUrl;
      log(`✓ Session URL: ${sessionUrl.slice(0, 60)}`, 'success');
    } catch (e: any) {
      log(`⚠ Session: ${e.message} — fallback basket URL`, 'warn');
    }

    // ─── ÉTAPE 9: Notification Discord ────────────────────────────────────────
    log('⑧ Envoi notification Discord...', 'step');
    try {
      await sendDiscordNotification(
        config.discord_webhook_url, config.discord_user_id_to_ping,
        basket, cookies, eventInfo,
        store.state.tasks.find(t => t.id === taskId)?.proxyLabel ?? proxyUrl.slice(-8),
        sessionUrl,
        place.dateSeance,
      );
      log('✓ Notification Discord envoyée', 'success');
    } catch (e: any) {
      log(`⚠ Discord: ${e.message}`, 'warn');
    }

  } catch (err: any) {
    fail(err.message ?? 'Erreur inconnue');
  }
};
