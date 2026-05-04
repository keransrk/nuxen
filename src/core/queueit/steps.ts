import { HttpClient } from '../../utils/http.js';
import { sleep } from '../../utils/random.js';
import { logger } from '../../utils/logger.js';
import { store } from '../store.js';
import type { LogLevel } from '../store.js';
import { solveRecaptchaV2 } from '../recaptcha.js';
import { solvePoW } from './pow.js';
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
  stopSignal?: { stopped: boolean }
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
  const visitorSessionRaw = Object.entries(queueClient.cookieJar.toObject())
    .filter(([k]) => k.toLowerCase().includes('visitorsession'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const hashMatch = html.match(/challengeApiChecksumHash\s*[=:]\s*["']([^"']+)["']/);
  const challengeHash = hashMatch ? hashMatch[1] : '';
  if (!challengeHash) qlog('  [!] challengeHash introuvable', 'warn');
  else qlog(`  [OK] hash extrait: ${challengeHash.slice(0, 20)}...`, 'success');

  qlog(`  [info] enqueueToken: ${enqueueToken ? enqueueToken.slice(0, 60) + '...' : '(vide)'}`, 'info');

  const queueItBase = `https://${customerId}.queue-it.net`;

  // Headers for the challenge POST requests (exactly as browser sends)
  const challengeRequestHeaders = {
    Accept: '*/*',
    'Accept-Language': 'fr-FR',
    Origin: queueItBase,
    Referer: queueItUrl,
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
    'Cookie': visitorSessionRaw,
  };

  // Headers for XHR verify/enqueue requests
  const challengeHeaders = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'fr-FR',
    'Content-Type': 'application/json',
    Origin: queueItBase,
    Referer: queueItUrl,
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
    'Cookie': visitorSessionRaw,
  };

  // -- STEPS Q2-Q9: Challenge loop (retried on IP mismatch or challengeFailed) --
  // Oxylabs residential proxies can assign different IPs on separate TCP connections.
  // Queue-it requires rcSessionInfo.sourceIp === powSessionInfo.sourceIp at enqueue.
  // We retry the full challenge sequence until IPs match and enqueue succeeds.
  const MAX_CHALLENGE_RETRIES = 6;

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

  for (let attempt = 1; attempt <= MAX_CHALLENGE_RETRIES; attempt++) {
    const attemptSuffix = attempt > 1 ? ` (tentative ${attempt}/${MAX_CHALLENGE_RETRIES})` : '';

    // -- Q2: GET reCAPTCHA challenge --
    qlog(`  [Q2] GET reCAPTCHA challenge${attemptSuffix}...`, 'step');
    const rcChallengeRes = await queueClient.post(
      `${queueItBase}/challengeapi/recaptcha/challenge/`,
      null,
      { headers: challengeRequestHeaders, skipDelay: true } as any
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
      { headers: challengeHeaders, skipDelay: true } as any
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
      { headers: challengeRequestHeaders, skipDelay: true } as any
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
      { headers: challengeHeaders, skipDelay: true } as any
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
      qlog(`  [!] IP mismatch (rc=${rcIP} pow=${powIP}) - retry challenge...`, 'warn');
      if (attempt < MAX_CHALLENGE_RETRIES) continue;
      throw new Error(`Queue-it: IP mismatch persistant apres ${MAX_CHALLENGE_RETRIES} tentatives`);
    }
    qlog(`  [info] IP match OK: ${rcIP}`, 'info');

    // -- Q9: POST enqueue --
    qlog('  [Q9] POST enqueue - entree dans la file...', 'step');
    const enqueueUrl = `${queueItBase}/spa-api/queue/${customerId}/${eventId}/enqueue`
      + `?cid=fr-FR&l=${encodeURIComponent('Generic TMFR and partners 2024')}`
      + `&t=${encodeURIComponent(targetUrl)}`;

    const enqueueBody = {
      challengeSessions: [recaptchaSessionInfo, powSessionInfo].filter(s => s != null),
      layoutName: 'Generic TMFR and partners 2024',
      customUrlParams: '',
      targetUrl,
      CustomDataEnqueue: null,
      QueueitEnqueueToken: enqueueToken || null,
      Referrer: '',
    };

    const enqueueRes = await queueClient.post(enqueueUrl, JSON.stringify(enqueueBody), {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'fr-FR',
        'Content-Type': 'application/json',
        Origin: queueItBase,
        Referer: queueItUrl,
        'x-requested-with': 'XMLHttpRequest',
        'x-queueit-qpage-referral': '',
        'User-Agent': UA,
        'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Cookie': visitorSessionRaw,
      },
      skipDelay: true,
    } as any);

    enqueueResData = enqueueRes.data;
    enqueueResHeaders = enqueueRes.headers as Record<string, any>;
    queueClient.cookieJar.ingest(enqueueRes.headers['set-cookie']);
    qlog(`  [info] enqueue response: ${JSON.stringify(enqueueResData).slice(0, 300)}`, 'info');

    if (enqueueResData?.invalidQueueitEnqueueToken) throw new Error('Queue-it: invalidQueueitEnqueueToken');

    if (enqueueResData?.challengeFailed) {
      qlog(`  [!] challengeFailed malgre IP match - retry ${attempt}/${MAX_CHALLENGE_RETRIES}...`, 'warn');
      if (attempt < MAX_CHALLENGE_RETRIES) continue;
      throw new Error(`Queue-it: challengeFailed persistant apres ${MAX_CHALLENGE_RETRIES} tentatives: ${JSON.stringify(enqueueResData).slice(0, 200)}`);
    }

    if (!enqueueResData?.queueId) {
      throw new Error(`Queue-it: enqueue sans queueId: ${JSON.stringify(enqueueResData).slice(0, 300)}`);
    }

    queueId = enqueueResData.queueId;
    break; // Succès
  }

  if (!queueId) throw new Error('Queue-it: echec challenge apres toutes les tentatives');
  qlog(`  [OK] Enqueue! ID=${queueId.slice(0, 8)}... - polling toutes les 10s`, 'success');

  // -- STEP 10: Poll /status until redirect --
  const seid = crypto.randomUUID();
  const sets = Date.now().toString();
  const layoutName = 'Generic TMFR and partners 2024';
  let layoutVersion = 179115981772;
  let queueItemHeader = (enqueueResHeaders['x-queueit-queueitem-v2'] as string) || '';
  let pollCount = 0;
  const POLL_INTERVAL_MS = 10000;
  const maxPolls = 6 * 60; // 1h max

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
