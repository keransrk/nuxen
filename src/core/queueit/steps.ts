import { HttpClient } from '../../utils/http.js';
import { sleep } from '../../utils/random.js';
import { logger } from '../../utils/logger.js';
import { store } from '../store.js';
import type { LogLevel } from '../store.js';
import { solveRecaptchaV2 } from '../recaptcha.js';
import { solvePoW } from './pow.js';
import { solveAkamaiAbck } from './akamai.js';
import { findAkamaiScriptPath, runAkamaiVmBypass } from './akamai-vm.js';
import crypto from 'crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export interface QueueItResult {
  queueItCookie: string;
  queueittoken: string;
  redirectUrl: string;
}

export interface TaskUpdate {
  queuePosition?: string;
  forecastStatus?: string;
}

export const runQueueIt = async (
  queueItUrl: string,
  proxyUrl: string,
  capsolverKey: string,
  taskId: number,
  onUpdate?: (update: TaskUpdate) => void,
  stopSignal?: { stopped: boolean },
  pollMaxMinutes?: number,
  riskbypassKey?: string,
): Promise<QueueItResult> => {
  const queueClient = new HttpClient({ proxyUrl, delayMs: 3000 });

  const qlog = (msg: string, level: LogLevel = 'queue') => {
    store.appendLog(taskId, msg, level);
    logger.info(taskId, msg);
  };

  // -- STEP 1: Parse Queue-it URL --
  const urlObj = new URL(queueItUrl);
  const enqueueToken = urlObj.searchParams.get('enqueuetoken') || '';
  const eventId = urlObj.searchParams.get('e') || '';
  const targetUrl = decodeURIComponent(urlObj.searchParams.get('t') || '');
  const customerId = urlObj.searchParams.get('c') || 'ticketmasterfr';

  // Construct the /view URL - this is the actual page URL after Queue-it's redirect,
  // and where the browser's JS runs. All XHR calls from the browser use this as Referer.
  const queueItViewUrlObj = new URL(queueItUrl);
  if (!queueItViewUrlObj.pathname.startsWith('/view')) {
    queueItViewUrlObj.pathname = '/view';
  }
  const queueItViewUrl = queueItViewUrlObj.toString();

  qlog(`  Queue-it: event=${eventId}`, 'info');

  // -- STEP 2: GET Queue-it page --
  qlog('  [Q1] GET page Queue-it...', 'step');
  const pageRes = await queueClient.get(queueItUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: 'https://www.ticketmaster.fr/',
    },
  });

  const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';

  queueClient.cookieJar.ingest(pageRes.headers['set-cookie']);

  // Base URL pour toutes les requêtes Queue-it (spa-api + challengeapi)
  // Certains events utilisent wait.ticketmaster.fr (branded), d'autres ticketmasterfr.queue-it.net
  // On utilise le domaine RÉEL de l'URL reçue plutôt que de reconstruire depuis le customerId
  const queueItBase = urlObj.hostname.includes('queue-it.net')
    ? `https://${customerId}.queue-it.net`
    : `https://${urlObj.hostname}`;  // ex: https://wait.ticketmaster.fr

  // -- Détection Akamai Bot Manager --
  // wait.ticketmaster.fr intègre Akamai Bot Manager via deux mécanismes :
  //  1. Un script UI Queue-it (akamai-bot-manager-header-verification.min.js) dans le HTML
  //  2. Un script d'injection Akamai servi en GET depuis wait.ticketmaster.fr (chemin relatif /xxxx/...)
  //     Ce script génère le "sensor_data" (fingerprint navigateur) et le POSTe au même endpoint.
  //     Sans ce POST, l'enqueue retourne rticr=2 (softblock permanent).
  //
  // Stratégie de bypass (par ordre de préférence) :
  //   A) VM locale : exécuter le script Akamai dans un sandbox Node.js (gratuit, rapide)
  //   B) RiskBypass API : fallback si le VM ne capte pas le sensor_data (payant, ~3s)
  const akamaiUiJsMatch = html.match(/(https?:\/\/[^"']+akamai-bot-manager[^"']*\.js)/);
  const akamaiUiJsUrl = akamaiUiJsMatch ? akamaiUiJsMatch[1] : null;

  // Détection via le chemin relatif Akamai dans le HTML (ex: /jiaq02cf-EbK/...)
  const akamaiScriptPath = findAkamaiScriptPath(html);

  const akamaiDetected = !!(akamaiUiJsUrl || akamaiScriptPath);

  if (akamaiDetected) {
    qlog(`  [info] Akamai Bot Manager detecte${akamaiUiJsUrl ? ' (UI: ' + akamaiUiJsUrl.slice(-50) + ')' : ''}${akamaiScriptPath ? ' (injection: ' + akamaiScriptPath.slice(0, 45) + '...)' : ''}`, 'info');

    // -- Tentative A : bypass Playwright (Chromium headless, vrai navigateur) --
    const cookieHeaderNow = queueClient.cookieJar.toString();
    const vmSuccess = await runAkamaiVmBypass(
      html,
      queueItBase,
      queueItViewUrl,
      UA,
      cookieHeaderNow,
      proxyUrl,
      (msg, level) => qlog(msg, level as LogLevel ?? 'info'),
      (playwrightCookies) => {
        // Merge cookies set by Playwright (including validated _abck) back into session jar
        for (const c of playwrightCookies) {
          if (c.name && c.value) {
            queueClient.cookieJar.set(c.name, c.value);
          }
        }
        qlog(`  [info] Akamai: ${playwrightCookies.length} cookie(s) fusionnes depuis Playwright`, 'info');
      },
    );

    if (!vmSuccess) {
      // -- Tentative B : fallback RiskBypass API --
      if (!riskbypassKey) {
        throw new Error(
          'Queue-it: Akamai detecte, bypass VM echoue. ' +
          'Ajoutez "riskbypass_api_key" dans config.json (riskbypass.com) ' +
          'pour activer le fallback payant.'
        );
      }
      // Extraire les paramètres pour RiskBypass
      const akamaiJsUrl = akamaiUiJsUrl ?? '';
      const pageFpMatch = html.match(/\b(\d{6,8})\b(?=[^;]*akamai|[^;]*sensor)/);
      const pageFp = pageFpMatch ? pageFpMatch[1] : '';

      qlog('  [Q0] Akamai: VM non disponible - fallback RiskBypass API...', 'step');
      const akamaiResult = await solveAkamaiAbck(
        riskbypassKey, queueItViewUrl, akamaiJsUrl, pageFp, proxyUrl,
      );
      qlog(`  [OK] Akamai _abck (RiskBypass) genere (UA: ${akamaiResult.userAgent.slice(0, 40)}...)`, 'success');
      for (const [k, v] of Object.entries(akamaiResult.cookies)) {
        queueClient.cookieJar.set(k, v);
      }
    }
  }

  const hashMatch = html.match(/challengeApiChecksumHash\s*[=:]\s*["']([^"']+)["']/);
  const challengeHash = hashMatch ? hashMatch[1] : '';
  if (!challengeHash) qlog('  [!] challengeHash introuvable', 'warn');
  else qlog(`  [OK] hash extrait: ${challengeHash.slice(0, 20)}...`, 'success');

  qlog(`  [info] enqueueToken: ${enqueueToken ? enqueueToken.slice(0, 60) + '...' : '(vide)'}`, 'info');
  qlog(`  [info] queueItBase: ${queueItBase}`, 'info');

  // Headers for the challenge POST requests (exactly as browser sends)
  // Cookie field is added dynamically inside the loop from the live jar
  const challengeRequestHeaders = {
    Accept: '*/*',
    'Accept-Language': 'fr-FR',
    Origin: queueItBase,
    Referer: queueItViewUrl,
    'User-Agent': UA,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'x-queueit-challange-customerid': customerId,
    'x-queueit-challange-eventid': eventId,
    'x-queueit-challange-hash': challengeHash,
    'x-queueit-challange-reason': '1',
    'x-queueit-challange-ruleid': '',
    'x-queueit-challange-rulename': '',
  };

  // Headers for XHR verify/enqueue requests
  // Cookie field is added dynamically inside the loop from the live jar
  const challengeHeaders = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'fr-FR',
    'Content-Type': 'application/json',
    Origin: queueItBase,
    Referer: queueItViewUrl,
    'User-Agent': UA,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'x-requested-with': 'XMLHttpRequest',
    'x-queueit-challange-customerid': customerId,
    'x-queueit-challange-eventid': eventId,
    'x-queueit-challange-hash': challengeHash,
    'x-queueit-challange-reason': '1',
    'x-queueit-challange-ruleid': '',
    'x-queueit-challange-rulename': '',
  };

  // -- PRE-ENQUEUE PROBE (pour events sans enqueueToken) --
  // Certains events Queue-it n'ont pas d'enqueueToken dans l'URL (flow JS côté client).
  // Dans ce cas, le navigateur fait un premier appel POST /enqueue sans challengeSessions,
  // ce qui crée une session côté serveur et déclenche officiellement le requirement de challenge.
  // Les challengeSessions créées APRÈS ce probe sont liées à cette session via le cookie
  // visitorsession → le serveur les accepte dans l'enqueue final.
  //
  // Sans ce probe, les sessions sont "orphelines" (pas liées à un enqueue déclenché)
  // et le serveur retourne challengeRequired: true même si reCAPTCHA+PoW sont résolus.
  const enqueueUrl = `${queueItBase}/spa-api/queue/${customerId}/${eventId}/enqueue`
    + `?cid=fr-FR&l=${encodeURIComponent('Generic TMFR and partners 2024')}`
    + `&t=${encodeURIComponent(targetUrl)}`;

  if (!enqueueToken) {
    qlog('  [Q1b] Pre-enqueue probe (pas d\'enqueueToken - flow JS)...', 'step');
    try {
      const probeRes = await queueClient.post(enqueueUrl, JSON.stringify({
        challengeSessions: [],
        layoutName: 'Generic TMFR and partners 2024',
        customUrlParams: '',
        targetUrl,
        CustomDataEnqueue: null,
        QueueitEnqueueToken: null,
        Referrer: targetUrl,
      }), {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'fr-FR',
          'Content-Type': 'application/json',
          Origin: queueItBase,
          Referer: queueItViewUrl,
          'x-requested-with': 'XMLHttpRequest',
          'x-queueit-qpage-referral': '',
          'User-Agent': UA,
          'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          Cookie: queueClient.cookieJar.toString(),
        },
        skipDelay: true,
      } as any);
      // Capturer les cookies de la réponse probe (marquent la session comme "challenge-pending")
      queueClient.cookieJar.ingest(probeRes.headers['set-cookie']);
      const probeData = probeRes.data;
      if (probeData?.challengeRequired === true) {
        qlog('  [OK] Probe: challengeRequired=true confirme - session initialisee pour le challenge', 'success');
      } else if (probeData?.queueId) {
        // Rare : l'event n'est pas encore actif et l'enqueue a directement reussi sans challenge
        qlog(`  [OK] Probe: enqueue direct sans challenge (queueId=${probeData.queueId.slice(0, 8)}...)`, 'success');
      } else {
        qlog(`  [info] Probe status=${probeRes.status} body: ${JSON.stringify(probeData).slice(0, 150)}`, 'info');
      }
    } catch (e: any) {
      // Non-fatal : on continue le flow normal
      qlog(`  [~] Probe echoue (${e.message?.slice(0, 80)}) - on continue sans`, 'warn');
    }
  }

  // -- STEPS Q2-Q9: Challenge loop (retried on IP mismatch or challengeFailed) --
  // Oxylabs residential proxies can assign different IPs on separate TCP connections.
  // Queue-it requires rcSessionInfo.sourceIp === powSessionInfo.sourceIp at enqueue.
  // We retry the full challenge sequence until IPs match and enqueue succeeds.
  // Two separate counters to avoid IP mismatch retries consuming softblock budget.
  const MAX_IP_RETRIES = 6;
  const MAX_SOFTBLOCK_RETRIES = 3;
  let ipMismatchCount = 0;
  let softblockCount = 0;

  const UA_STATS = {
    Browser: 'Chrome',
    BrowserVersion: '147',
    Os: 'Windows',
    OsVersion: '10',
    UserAgent: UA,
    Screen: '1920x1080',
  };

  let queueId: string | null = null;
  let enqueueResData: any = null;
  let enqueueResHeaders: Record<string, any> = {};

  for (let attempt = 1; attempt <= MAX_IP_RETRIES + MAX_SOFTBLOCK_RETRIES; attempt++) {
    const attemptSuffix = attempt > 1 ? ` (tentative ${attempt})` : '';

    // -- Q2: GET reCAPTCHA challenge --
    qlog(`  [Q2] GET reCAPTCHA challenge${attemptSuffix}...`, 'step');
    const rcChallengeRes = await queueClient.post(
      `${queueItBase}/challengeapi/recaptcha/challenge/`,
      null,
      { headers: { ...challengeRequestHeaders, Cookie: queueClient.cookieJar.toString() }, skipDelay: true } as any
    );

    const rcChallenge = rcChallengeRes.data;
    if (!rcChallenge?.sessionId) throw new Error(`Queue-it recaptcha challenge failed: ${JSON.stringify(rcChallenge)}`);
    const rcChallengeDetails = rcChallenge.challengeDetails ?? '';
    const rcSiteKey = rcChallenge.siteKey || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';
    if (attempt === 1) qlog(`  [info] rcChallenge keys: ${Object.keys(rcChallenge || {}).join(', ')}`, 'info');

    // -- Q3: Solve reCAPTCHA v2 via proxy --
    qlog('  [Q3] Resolution reCAPTCHA v2 - Capsolver (via proxy)...', 'step');
    const recaptchaToken = await solveRecaptchaV2(capsolverKey, rcSiteKey, queueItBase, taskId, proxyUrl);
    qlog('  [OK] reCAPTCHA v2 resolu', 'success');

    // -- Q4: Verify reCAPTCHA --
    qlog('  [Q4] POST verify reCAPTCHA...', 'step');
    const rcVerifyRes = await queueClient.post(
      `${queueItBase}/challengeapi/${customerId}/${eventId}/verify`,
      JSON.stringify({
        challengeType: 'recaptcha',
        sessionId: rcChallenge.sessionId,
        challengeDetails: rcChallengeDetails,
        solution: recaptchaToken,
        stats: { ...UA_STATS, Duration: 2000 },
        customerId,
        eventId,
        version: 6,
      }),
      { headers: { ...challengeHeaders, Cookie: queueClient.cookieJar.toString() }, skipDelay: true } as any
    );

    const rcVerify = rcVerifyRes.data;
    if (attempt === 1) qlog(`  [info] rcVerify status=${rcVerifyRes.status} keys: ${Object.keys(rcVerify || {}).join(', ')}`, 'info');
    if (rcVerifyRes.status >= 400 || rcVerify?.challengeFailed) {
      throw new Error(`Queue-it: reCAPTCHA verify failed (${rcVerifyRes.status}): ${JSON.stringify(rcVerify).slice(0, 300)}`);
    }
    const recaptchaSessionInfo = rcVerify?.sessionInfo
      ?? rcVerify?.challengeSession
      ?? rcVerify?.session
      ?? rcVerify?.challengeSessionInfo;
    if (!recaptchaSessionInfo) {
      qlog(`  [!] sessionInfo absent de rcVerify - body: ${JSON.stringify(rcVerify).slice(0, 200)}`, 'warn');
    }
    const rcIP = recaptchaSessionInfo?.sourceIp;
    qlog(`  [OK] reCAPTCHA verifie - IP: ${rcIP ?? '?'}`, 'success');

    // -- Q5: GET PoW challenge --
    qlog('  [Q5] GET ProofOfWork challenge...', 'step');
    const powChallengeRes = await queueClient.post(
      `${queueItBase}/challengeapi/pow/challenge/`,
      null,
      { headers: { ...challengeRequestHeaders, Cookie: queueClient.cookieJar.toString() }, skipDelay: true } as any
    );

    const powChallenge = powChallengeRes.data;
    if (!powChallenge?.sessionId) throw new Error(`Queue-it PoW challenge failed: ${JSON.stringify(powChallenge)}`);
    const powChallengeDetails = powChallenge.challengeDetails ?? '';
    if (attempt === 1) qlog(`  [info] powChallenge keys: ${Object.keys(powChallenge || {}).join(', ')}`, 'info');
    if (!powChallenge.function) throw new Error('Queue-it: PoW function body vide dans la reponse');
    if (!powChallenge.parameters) throw new Error('Queue-it: PoW parameters manquants');
    qlog('  [OK] PoW challenge recu', 'success');

    // -- Q7: Solve PoW locally --
    qlog(`  [Q7] Resolution PoW (runs=${powChallenge.parameters?.runs}, complexity=${powChallenge.parameters?.complexity})...`, 'step');
    const { solutionEncoded, durationMs } = await solvePoW(powChallenge);
    qlog(`  [OK] PoW resolu en ${durationMs}ms`, 'success');

    // -- Q8: Verify PoW --
    qlog('  [Q8] POST verify PoW...', 'step');
    const powVerifyRes = await queueClient.post(
      `${queueItBase}/challengeapi/${customerId}/${eventId}/verify`,
      JSON.stringify({
        challengeType: 'proofofwork',
        sessionId: powChallenge.sessionId,
        challengeDetails: powChallengeDetails,
        solution: solutionEncoded,
        stats: { ...UA_STATS, Duration: durationMs },
        customerId,
        eventId,
        version: 6,
      }),
      { headers: { ...challengeHeaders, Cookie: queueClient.cookieJar.toString() }, skipDelay: true } as any
    );

    const powVerify = powVerifyRes.data;
    if (attempt === 1) qlog(`  [info] powVerify status=${powVerifyRes.status} keys: ${Object.keys(powVerify || {}).join(', ')}`, 'info');
    if (powVerifyRes.status >= 400 || powVerify?.challengeFailed) {
      throw new Error(`Queue-it: PoW verify failed (${powVerifyRes.status}): ${JSON.stringify(powVerify).slice(0, 300)}`);
    }
    const powSessionInfo = powVerify?.sessionInfo
      ?? powVerify?.challengeSession
      ?? powVerify?.session
      ?? powVerify?.challengeSessionInfo;
    if (!powSessionInfo) {
      qlog(`  [!] sessionInfo absent de powVerify - body: ${JSON.stringify(powVerify).slice(0, 200)}`, 'warn');
    }
    const powIP = powSessionInfo?.sourceIp;
    qlog(`  [OK] PoW verifie - IP: ${powIP ?? '?'}`, 'success');

    // -- IP match check: bail early without calling enqueue --
    const ipMatch = rcIP && powIP && rcIP === powIP;
    if (!ipMatch) {
      ipMismatchCount++;
      qlog(`  [!] IP mismatch (rc=${rcIP} pow=${powIP}) - retry challenge...`, 'warn');
      if (ipMismatchCount < MAX_IP_RETRIES) continue;
      throw new Error(`Queue-it: IP mismatch persistant apres ${MAX_IP_RETRIES} tentatives`);
    }
    qlog(`  [info] IP match OK: ${rcIP}`, 'info');

    // -- Q9: POST enqueue --
    qlog('  [Q9] POST enqueue - entree dans la file...', 'step');

    // Snapshot complet du jar APRÈS Q4 et Q8 (incluant les cookies de vérification de challenge)
    const allCookiesAtEnqueue = queueClient.cookieJar.toString();
    const cookieCount = (allCookiesAtEnqueue.match(/=/g) || []).length;
    qlog(`  [info] cookies jar avant enqueue: ${cookieCount} cookie(s)`, 'info');

    const enqueueBody = {
      challengeSessions: [recaptchaSessionInfo, powSessionInfo].filter(s => s != null),
      layoutName: 'Generic TMFR and partners 2024',
      customUrlParams: '',
      targetUrl,
      CustomDataEnqueue: null,
      QueueitEnqueueToken: enqueueToken || null,
      Referrer: targetUrl,
    };

    const enqueueRes = await queueClient.post(enqueueUrl, JSON.stringify(enqueueBody), {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        Origin: queueItBase,
        Referer: queueItViewUrl,
        'x-requested-with': 'XMLHttpRequest',
        'x-queueit-qpage-referral': '',
        'User-Agent': UA,
        'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        // Tous les cookies du jar (visitorsession + cookies de vérif challenge Q4/Q8)
        Cookie: allCookiesAtEnqueue,
      },
      skipDelay: true,
    } as any);

    enqueueResData = enqueueRes.data;
    enqueueResHeaders = enqueueRes.headers as Record<string, any>;
    queueClient.cookieJar.ingest(enqueueRes.headers['set-cookie']);
    // Log complet (sans troncature) pour diagnostiquer le softblock
    qlog(`  [info] enqueue status=${enqueueRes.status} response: ${JSON.stringify(enqueueResData)}`, 'info');
    qlog(`  [info] challengeSessions envoyees: ${JSON.stringify(enqueueBody.challengeSessions).slice(0, 400)}`, 'info');

    if (enqueueResData?.invalidQueueitEnqueueToken) throw new Error('Queue-it: invalidQueueitEnqueueToken');

    if (enqueueResData?.challengeFailed) {
      qlog(`  [!] challengeFailed malgre IP match - retry...`, 'warn');
      if (ipMismatchCount < MAX_IP_RETRIES) { ipMismatchCount++; continue; }
      throw new Error(`Queue-it: challengeFailed persistant: ${JSON.stringify(enqueueResData).slice(0, 200)}`);
    }

    // Softblock Queue-it : le pre-enqueue probe n'a pas suffi ou la session a expire
    // On retry le challenge complet - les cookies du probe sont déjà dans le jar
    if (enqueueResData?.redirectUrl?.includes('/softblock/')) {
      softblockCount++;
      const rticr = (() => { try { return new URL(enqueueResData.redirectUrl, queueItBase).searchParams.get('rticr'); } catch { return '?'; } })();
      qlog(`  [!] softblock Queue-it (rticr=${rticr}) - tentative softblock ${softblockCount}/${MAX_SOFTBLOCK_RETRIES}...`, 'warn');
      if (softblockCount < MAX_SOFTBLOCK_RETRIES) continue;
      throw new Error(`Queue-it: softblock persistant apres ${MAX_SOFTBLOCK_RETRIES} tentatives (rticr=${rticr})`);
    }

    // queueId peut venir du body OU du header x-queueit-queueitem-v2
    const queueIdFromHeader = (enqueueRes.headers['x-queueit-queueitem-v2'] as string || '')
      .split('~').find(p => /^[0-9a-f-]{36}$/i.test(p)) ?? '';

    if (!enqueueResData?.queueId && !queueIdFromHeader) {
      throw new Error(`Queue-it: enqueue sans queueId: status=${enqueueRes.status} body=${JSON.stringify(enqueueResData).slice(0, 300)}`);
    }

    queueId = enqueueResData?.queueId || queueIdFromHeader;
    break; // Succès
  }

  if (!queueId) throw new Error('Queue-it: echec challenge apres toutes les tentatives');  qlog(`  [OK] Enqueue! ID=${queueId.slice(0, 8)}... - polling toutes les 10s`, 'success');

  // -- STEP 10: Poll /status until redirect --
  const seid = crypto.randomUUID();
  const sets = Date.now().toString();
  const layoutName = 'Generic TMFR and partners 2024';
  let layoutVersion = 179115981772;
  let queueItemHeader = (enqueueResHeaders['x-queueit-queueitem-v2'] as string) || '';
  let pollCount = 0;
  const POLL_INTERVAL_MS = 10000;
  const maxPolls = Math.ceil((pollMaxMinutes ?? 60) * 60 * 1000 / POLL_INTERVAL_MS);

  while (pollCount < maxPolls) {
    if (stopSignal?.stopped) throw new Error('Task arretee par utilisateur');

    pollCount++;
    await sleep(POLL_INTERVAL_MS);

    const statusUrl = `${queueItBase}/spa-api/queue/${customerId}/${eventId}/${queueId}/status`
      + `?cid=fr-FR`
      + `&l=${encodeURIComponent(layoutName)}`
      + `&t=${encodeURIComponent(targetUrl)}`
      + `&seid=${seid}`
      + `&sets=${sets}`;

    const statusHeaders: Record<string, string> = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      Origin: queueItBase,
      Referer: queueItUrl,
      'User-Agent': UA,
      'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Cookie': queueClient.cookieJar.toString(),
    };

    if (queueItemHeader) statusHeaders['X-Queueit-Queueitem-V2'] = queueItemHeader;

    const statusRes = await queueClient.request({
      method: 'POST',
      url: statusUrl,
      headers: statusHeaders,
      data: JSON.stringify({
        targetUrl,
        customUrlParams: '',
        layoutVersion,
        layoutName,
        isClientRedayToRedirect: true,
        isBeforeOrIdle: false,
      }),
      skipDelay: true,
    } as any);

    const newHeader = statusRes.headers['x-queueit-queueitem-v2'];
    if (newHeader) queueItemHeader = newHeader;
    if (statusRes.data?.layoutVersion) layoutVersion = statusRes.data.layoutVersion;

    if (!statusRes.data || statusRes.status >= 400) continue;

    const d = statusRes.data;
    const ticket = d.ticket || {};
    const ahead = ticket.usersInLineAheadOfYou ?? '?';
    const whichIsIn: string = ticket.whichIsIn ?? '';
    const forecast: string = d.forecastStatus || 'NotReadyYet';

    if (onUpdate) onUpdate({ queuePosition: String(ahead), forecastStatus: forecast });

    qlog(`  [Q] Position: ${ahead} devant toi${whichIsIn ? ` | ${whichIsIn}` : ''} (${forecast})`, 'queue');

    if (d.redirectUrl && d.isRedirectToTarget) {
      const redirectUrl: string = d.redirectUrl;
      const qtokenMatch = redirectUrl.match(/queueittoken=([^&]+)/);
      const queueittoken = qtokenMatch ? decodeURIComponent(qtokenMatch[1]) : '';

      queueClient.cookieJar.ingest(statusRes.headers['set-cookie']);
      const allCookies = queueClient.cookieJar.toObject();
      const queueItCookieName = Object.keys(allCookies).find(k => k.toLowerCase().includes('queueitaccepted'));
      const queueItCookieValue = queueItCookieName ? allCookies[queueItCookieName] : '';
      const queueItCookie = queueItCookieName ? `${queueItCookieName}=${queueItCookieValue}` : '';

      qlog('  [OK] File passee! Redirection recue', 'success');
      return { queueItCookie, queueittoken, redirectUrl };
    }
  }

  throw new Error('Queue-it: timeout apres 1h de polling');
};
