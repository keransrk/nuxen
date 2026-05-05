import { HttpClient } from '../utils/http.js';
import { generateCookies } from './cookies.js';
import { solveRecaptchaInvisible } from './recaptcha.js';
import { getGrilleTarifaire, pickRandomPlace } from './grilleTarif.js';
import { purchaseInit } from './purchaseInit.js';
import { runQueueIt } from './queueit/index.js';
import { sendDiscordNotification } from './discord.js';
import { sendSession } from './session.js';
import { store, type LogLevel } from './store.js';
import { logger } from '../utils/logger.js';
import { ProxyPool } from '../config/proxyFile.js';
import { TokenPool } from '../utils/tokenPool.js';
import type { AppConfig } from '../config/loader.js';
import type { EventInfo } from './eventResolver.js';
import type { TmCookies } from './cookies.js';
import type { TaskRow } from '../config/taskCsv.js';

export interface StopSignal {
  stopped: boolean;
}

// Erreur speciale qui declenche la rotation de proxy
class ProxyRotateError extends Error {
  constructor(step: string, cause: Error) {
    super(`[rotate] ${step}: ${cause.message}`);
    this.name = 'ProxyRotateError';
  }
}

// Verifie si une erreur est liee au proxy et doit declencher la rotation
const shouldRotate = (e: any): boolean => ProxyPool.isProxyError(e);

const runTaskAttempt = async (
  taskId: number,
  proxyUrl: string,
  eventInfo: EventInfo,
  config: AppConfig,
  stopSignal: StopSignal,
  row: TaskRow,
  log: (msg: string, level?: LogLevel) => void,
  fail: (err: string) => void
) => {
  // --- ETAPE 1: Generer les cookies ---
  store.updateTask(taskId, { status: 'cookies', statusText: 'Generation cookies...' });
  log('>> Generation cookies - GET /eps-mgr...', 'step');

  let cookies: TmCookies;
  try {
    cookies = await generateCookies(config.capsolver_api_key, proxyUrl, taskId);
  } catch (e: any) {
    if (shouldRotate(e)) throw new ProxyRotateError('cookies', e);
    return fail(`Cookies: ${e.message}`);
  }

  if (cookies.ok) {
    log('[OK] Cookies TM generes (eps_sid + SID + BID + tmpt)', 'success');
  } else {
    log('[!] Cookies incomplets - certains manquants', 'warn');
  }

  if (stopSignal.stopped) return;

  const tmClient = new HttpClient({ proxyUrl, delayMs: config.request_delay_ms });
  tmClient.cookieJar.ingestString(cookies.cookieString);
  tmClient.cookieJar.set('tkm_i18n', 'fr');

  // --- ETAPE 2: Verifier la page evenement (Queue-it eventuelle) ---
  store.updateTask(taskId, { status: 'grille', statusText: 'Verification page evenement...' });
  log('>> Verification page evenement (Queue-it?)...', 'step');

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
      timeout: 20000,
      // garde le délai config : simule un humain qui arrive sur la page après les cookies
    } as any);

    let queueItDetectedUrl: string | null = null;
    if (pageRes.status === 302 || pageRes.status === 301) {
      const location: string = pageRes.headers['location'] || '';
      // TM utilise deux domaines selon les events :
      //   - queue-it.net (direct)
      //   - wait.ticketmaster.fr (alias TM qui redirige vers queue-it.net)
      if (location.includes('queue-it.net') || location.includes('wait.ticketmaster.fr')) {
        queueItDetectedUrl = location;
        log('[Q] Queue-it detecte (redirect 302 sur page evenement)', 'queue');
      }
    }

    if (!queueItDetectedUrl && pageRes.status === 200) {
      const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';

      // --- Détection Queue-it côté client (JS integration) ---
      // TM intègre Queue-it via JS sur la page (200) → la redirection est déclenchée
      // par le script, pas par le serveur. On détecte la présence des scripts.
      const hasQueueItScript = (
        html.includes('static.queue-it.net') ||
        html.includes('c2.queue-it.net') ||
        html.includes('queue-it.net') ||
        html.includes('wait.ticketmaster.fr') ||
        html.includes('queueclient.min.js') ||
        html.includes('QueueITEngine')
      );

      if (hasQueueItScript) {
        // Extraire la config Queue-it (customerId, eventId)
        const customerMatch = html.match(/"customerId"\s*:\s*"([^"]+)"/) ||
                              html.match(/customerId\s*:\s*["']([^"']+)["']/) ||
                              html.match(/["']c["']\s*:\s*["']([^"']+)["']/);
        const eventMatch    = html.match(/"eventId"\s*:\s*"([^"]+)"/) ||
                              html.match(/eventId\s*:\s*["']([^"']+)["']/) ||
                              html.match(/["']e["']\s*:\s*["']([^"']+)["']/);
        const targetMatch   = html.match(/"targetUrl"\s*:\s*decodeURIComponent\('([^']+)'\)/) ||
                              html.match(/"targetUrl"\s*:\s*["']([^"']+)["']/);

        const cid = customerMatch?.[1] ?? 'ticketmasterfr';
        const eid = eventMatch?.[1] ?? '';
        const t   = targetMatch ? decodeURIComponent(targetMatch[1]) : pageUrl;

        if (eid) {
          queueItDetectedUrl = `https://wait.ticketmaster.fr/?c=${cid}&e=${eid}&ver=javascript-4.4.2&t=${encodeURIComponent(t)}`;
          log(`[Q] Queue-it detecte (HTML JS integration, event=${eid})`, 'queue');
        } else {
          // Queue-it scripts présents mais config non extractible depuis HTML statique
          // → la redirection est uniquement JS, on le note et on tente sans Queue-it
          log('[!] Queue-it scripts detectes (JS-only) - eventId introuvable dans HTML statique', 'warn');
          log('[!] Tentative sans Queue-it - si grille vide retry sera declenche', 'warn');
        }
      } else {
        // Fallback : anciennes détections (TM SPA v1)
        const isQueueItPage = html.includes('queue-it.net') && (
          html.includes('"integrations":[{') ||
          html.includes('data-pageid="queue"') ||
          html.includes('data-pageid="before"')
        );
        if (isQueueItPage) {
          const customerMatch2 = html.match(/"customerId"\s*:\s*"([^"]+)"/);
          const eventMatch2    = html.match(/"eventId"\s*:\s*"([^"]+)"/);
          const targetMatch2   = html.match(/"targetUrl"\s*:\s*decodeURIComponent\('([^']+)'\)/);
          if (customerMatch2 && eventMatch2) {
            const cid = customerMatch2[1];
            const eid = eventMatch2[1];
            const t = targetMatch2 ? targetMatch2[1] : encodeURIComponent(pageUrl);
            queueItDetectedUrl = `https://wait.ticketmaster.fr/?c=${cid}&e=${eid}&ver=javascript-4.4.2&t=${t}`;
            log(`[Q] Queue-it detecte (HTML SPA, event=${eid})`, 'queue');
          } else {
            log('[!] Queue-it probable (scripts detectes) - attente purchase/init', 'warn');
          }
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
            if (forecast === 'FirstInLine') log('[*] Premier dans la file!', 'queue');
          },
          stopSignal,
          config.poll_status_max_minutes,
          config.riskbypass_api_key || undefined,
        );
      } catch (e: any) {
        if (shouldRotate(e)) throw new ProxyRotateError('queue-it', e);
        return fail(`Queue-it: ${e.message}`);
      }
      if (stopSignal.stopped) return;
      queueItCookie = queueResult.queueItCookie;
      if (queueItCookie) tmClient.cookieJar.ingestString(queueItCookie);
      log('[OK] File passee! Acces accorde', 'success');
    } else if (pageRes.status === 200) {
      const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';
      const hasQueueHints = html.includes('queue-it.net') || html.includes('wait.ticketmaster.fr') || html.includes('queueclient');
      if (hasQueueHints) {
        // Scripts détectés mais eventId inconnu → on log un extrait pour debug
        const qIdx = html.indexOf('queue-it');
        const snippet = qIdx !== -1 ? html.slice(Math.max(0, qIdx - 80), qIdx + 200) : '';
        log(`[!] Queue-it scripts dans HTML mais config non extraite. Snippet: ${snippet.slice(0, 200)}`, 'warn');
      }
      log('[OK] Page evenement OK - pas de Queue-it detecte', 'success');
    }
  } catch (e: any) {
    if (e instanceof ProxyRotateError) throw e;
    if (shouldRotate(e)) throw new ProxyRotateError('page-evenement', e);
    if (!String(e.message).includes('Queue-it')) {
      log(`[!] Verif. page: ${e.message} - on continue`, 'warn');
    } else {
      return fail(`Page evenement: ${e.message}`);
    }
  }

  if (stopSignal.stopped) return;

  // ═══════════════════════════════════════════════════════════════════
  // BOUCLE D'ACHAT : grille → place → recaptcha → purchase → discord
  // TokenPool: POOL_SIZE tâches Capsolver tournent en parallèle.
  // Quand un token est consommé, un nouveau est immédiatement lancé.
  // Le prochain token est presque toujours prêt sans attente.
  // ═══════════════════════════════════════════════════════════════════
  const POOL_SIZE = 3;
  let cartCount = 0;

  const tokenPool = new TokenPool(
    () => solveRecaptchaInvisible(config.capsolver_api_key, taskId, proxyUrl),
    POOL_SIZE,
    log,
  );
  log(`[info] TokenPool démarré (${POOL_SIZE} tokens Capsolver en parallèle)`, 'info');

  try {
  while (!stopSignal.stopped) {
    // --- ETAPE 3: Charger la grille tarifaire ---
    store.updateTask(taskId, { status: 'grille', statusText: 'Chargement grille tarifaire...' });
    log('>> Chargement grille tarifaire...', 'step');

    let seances: any[];
    try {
      seances = await getGrilleTarifaire(tmClient, eventInfo.idmanif, taskId, eventInfo.slug);
    } catch (e: any) {
      if (shouldRotate(e)) throw new ProxyRotateError('grille', e);
      return fail(`Grille tarifaire: ${e.message}`);
    }

    // Si la grille est vide et qu'on n'a pas encore de cookie Queue-it,
    // c'est souvent signe que Queue-it protège l'accès.
    if (seances.length === 0 && !queueItCookie) {
      log('[!] Grille vide sans Queue-it cookie - event probablement protege par Queue-it JS', 'warn');
      log('[!] Ajoute la Queue-it URL manuellement dans le CSV ou verifie le snippet HTML ci-dessus', 'warn');
      return fail('Grille vide - Queue-it non detecte automatiquement. Verifier les logs.');
    }

    if (stopSignal.stopped) break;

    // --- ETAPE 4: Selection random de place ---
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
      return fail(`Selection place: ${e.message}`);
    }

    log(`[OK] Seance ${place.idseanc} - ${place.llgcatpl} - ${place.qty}x ${place.price}EUR`, 'success');
    store.updateTask(taskId, { statusText: `${place.llgcatpl} | ${place.qty}x ${place.price}EUR` });

    if (stopSignal.stopped) break;

    // --- ETAPE 5: reCAPTCHA invisible depuis le pool (quasi-instantané) ---
    store.updateTask(taskId, { status: 'recaptcha', statusText: `reCAPTCHA (pool: ${tokenPool.pending} prêts)...` });
    log(`>> reCAPTCHA invisible - pool (${tokenPool.pending} en attente)...`, 'step');
    let recaptchaToken: string;
    try {
      recaptchaToken = await tokenPool.next();
      log('[OK] reCAPTCHA token prêt (pool)', 'success');
    } catch (e: any) {
      if (shouldRotate(e)) throw new ProxyRotateError('recaptcha', e);
      return fail(`reCAPTCHA: ${e.message}`);
    }

    if (stopSignal.stopped) break;

    if (stopSignal.stopped) return;

    // --- ETAPE 6: Purchase init ---
    store.updateTask(taskId, { status: 'purchase', statusText: 'Creation du panier...' });
    log('>> POST /api/purchase/init...', 'step');

    let purchaseResult: any;
    try {
      purchaseResult = await purchaseInit(
        tmClient, eventInfo.idmanif, eventInfo.slug,
        place, recaptchaToken, taskId, queueItCookie,
        row.offerCode,
      );
    } catch (e: any) {
      if (shouldRotate(e)) throw new ProxyRotateError('purchase', e);
      return fail(`Purchase init: ${e.message}`);
    }

    // --- ETAPE 7: Si Queue-it detecte sur purchase (fallback) ---
    if (purchaseResult.isQueueIt) {
      store.updateTask(taskId, { status: 'queued', statusText: 'File Queue-it (purchase)...', queuePosition: '?' });
      log('[Q] Queue-it detecte sur purchase/init - bypass...', 'queue');

      let queueResult: any;
      try {
        queueResult = await runQueueIt(
          purchaseResult.queueItUrl, proxyUrl, config.capsolver_api_key, taskId,
          (update) => {
            const pos = update.queuePosition ?? '?';
            const forecast = update.forecastStatus ?? '';
            store.updateTask(taskId, { queuePosition: pos, forecastStatus: forecast, statusText: `File: ${pos} devant` });
            if (forecast === 'FirstInLine') log('[*] Premier dans la file!', 'queue');
          },
          stopSignal,
          config.poll_status_max_minutes,
          config.riskbypass_api_key || undefined,
        );
      } catch (e: any) {
        if (shouldRotate(e)) throw new ProxyRotateError('queue-it-purchase', e);
        return fail(`Queue-it: ${e.message}`);
      }

      if (stopSignal.stopped) break;

      queueItCookie = queueResult.queueItCookie;
      log('[OK] File passee! 2eme tentative purchase/init...', 'success');
      store.updateTask(taskId, { status: 'purchase', statusText: 'Panier (post-queue)...' });

      log('>> reCAPTCHA invisible (post-queue) - pool...', 'step');
      try {
        recaptchaToken = await tokenPool.next();
      } catch (e: any) {
        if (shouldRotate(e)) throw new ProxyRotateError('recaptcha-post-queue', e);
        return fail(`reCAPTCHA post-queue: ${e.message}`);
      }
      log('[OK] reCAPTCHA resolu', 'success');

      log('>> POST /api/purchase/init (post-queue)...', 'step');
      try {
        purchaseResult = await purchaseInit(
          tmClient, eventInfo.idmanif, eventInfo.slug,
          place, recaptchaToken, taskId, queueItCookie,
          row.offerCode,
        );
      } catch (e: any) {
        if (shouldRotate(e)) throw new ProxyRotateError('purchase-post-queue', e);
        return fail(`Purchase post-queue: ${e.message}`);
      }

      if (purchaseResult.isQueueIt) return fail('Queue-it re-detecte - abandon');
    }

    // --- ETAPE 7bis: Verification contiguite ---
    const basket = purchaseResult.basket;
    const firstItem = basket.items?.[0];
    const isContiguous = !firstItem?.warningNoContiguousTickets;

    if (row.acceptContiguous && !isContiguous) {
      log('[!] Non contigu - retry immediat pour nouvelles places...', 'warn');
      continue; // relancer sans fail : essayer d'autres places
    }

    // --- ETAPE 8: Succes ---
    cartCount++;
    const sub = basket.items?.[0]?.subEventBasketDto?.[0];
    const tickets = sub?.tickets ?? [];
    const seatsStr = tickets.map((t: any) => `${t.llgzone} R${t.rgplac} S${t.numplac}`).join(' | ') || 'Automatique';

    log(`[OK] PANIER #${cartCount} CREE! ID #${basket.id} - ${basket.price}EUR${isContiguous ? ' | contigu' : ' | non-contigu'}`, 'success');
    log(`  ${sub?.llgcatpl ?? place.llgcatpl} | ${seatsStr}`, 'success');

    store.updateTask(taskId, {
      status: 'success',
      statusText: `#${cartCount}x | Last: #${basket.id} ${basket.price}EUR`,
      basketId: basket.id,
      price: basket.price,
      category: sub?.llgcatpl ?? place.llgcatpl,
      seats: seatsStr,
      completedAt: new Date(),
    });

    // --- ETAPE 9: Session tm.sdss.fr ---
    let sessionUrl = `https://www.ticketmaster.fr/fr/panier?basketId=${basket.id}`;
    try {
      const sessionResult = await sendSession(basket, cookies, eventInfo, taskId);
      sessionUrl = sessionResult.sessionUrl;
    } catch (e: any) {
      log(`[!] Session: ${e.message} - fallback basket URL`, 'warn');
    }

    // --- ETAPE 10: Notification Discord ---
    const webhookUrl = row.webhook || config.default_webhook_url;
    const proxyLabel = store.state.tasks.find(t => t.id === taskId)?.proxyLabel ?? proxyUrl.slice(-8);
    try {
      await sendDiscordNotification(
        webhookUrl, '',
        basket, cookies, eventInfo,
        proxyLabel,
        sessionUrl,
        place.dateSeance,
        isContiguous,
      );
      log('[OK] Notification Discord envoyee', 'success');
    } catch (e: any) {
      log(`[!] Discord: ${e.message}`, 'warn');
    }

    // Boucle immédiate — nouveau panier avec les mêmes cookies/session
    log(`>> Relance immediate (#${cartCount + 1}) - pool: ${tokenPool.pending} tokens prêts...`, 'step');
  }
  } finally {
    tokenPool.destroy();
  }
};

export const runTask = async (
  taskId: number,
  proxyPool: ProxyPool,
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

  // Nombre max de rotations = nombre de proxies (on essaie chaque proxy une fois)
  const maxRotations = proxyPool.size;
  let rotations = 0;

  while (true) {
    const { url: proxyUrl, label: proxyLabel } = proxyPool.current;

    // Mettre a jour le label proxy affiché dans la task
    store.updateTask(taskId, { proxyLabel, proxyUrl });

    try {
      await runTaskAttempt(taskId, proxyUrl, eventInfo, config, stopSignal, row, log, fail);
      return; // Succes ou echec non-proxy : on sort
    } catch (e: any) {
      if (e instanceof ProxyRotateError) {
        rotations++;
        if (rotations < maxRotations) {
          const next = proxyPool.rotate();
          log(`[!] Proxy bloque (${proxyLabel}) - rotation ${rotations}/${maxRotations} -> ${next.label}`, 'warn');
          store.updateTask(taskId, {
            status: 'cookies',
            statusText: `Proxy ${rotations + 1}/${maxRotations} - reprise...`,
            logs: store.state.tasks.find(t => t.id === taskId)?.logs ?? [],
          });
          continue;
        } else {
          return fail(`Tous les proxies bloques (${maxRotations} essayes)`);
        }
      }
      // Erreur non liee au proxy
      fail(e.message ?? 'Erreur inconnue');
      return;
    }
  }
};
