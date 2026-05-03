import { HttpClient } from '../../utils/http.js';
import { sleep, randomInt } from '../../utils/random.js';
import { logger } from '../../utils/logger.js';
import { store } from '../store.js';
import type { LogLevel } from '../store.js';
import { solveRecaptchaV2 } from '../recaptcha.js';
import { solvePoW } from './pow.js';
import { CookieJar } from '../../utils/cookieJar.js';
import crypto from 'crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export interface QueueItResult {
  queueItCookie: string;   // QueueITAccepted-... cookie
  queueittoken: string;    // token from redirectUrl
  redirectUrl: string;     // final TM URL with queueittoken
}

export interface TaskUpdate {
  queuePosition?: string;  // "34 personnes devant toi"
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
  // Client Queue-it avec proxy
  const queueClient = new HttpClient({ proxyUrl, delayMs: 3000 });

  const qlog = (msg: string, level: LogLevel = 'queue') => {
    store.appendLog(taskId, msg, level);
    logger.info(taskId, msg);
  };

  // ÔöÇÔöÇÔöÇ STEP 1: Parser l'URL Queue-it ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const urlObj = new URL(queueItUrl);
  const enqueueToken = urlObj.searchParams.get('enqueuetoken') || '';
  const eventId = urlObj.searchParams.get('e') || '';
  const targetUrl = decodeURIComponent(urlObj.searchParams.get('t') || '');
  const customerId = urlObj.searchParams.get('c') || 'ticketmasterfr';

  qlog(`  Queue-it: event=${eventId}`, 'info');

  // ÔöÇÔöÇÔöÇ STEP 2: GET page Queue-it ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q1] GET page Queue-it...', 'step');
  const pageRes = await queueClient.get(queueItUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: 'https://www.ticketmaster.fr/',
    },
  });

  const html: string = typeof pageRes.data === 'string' ? pageRes.data : '';

  // Extract visitorSession cookie
  queueClient.cookieJar.ingest(pageRes.headers['set-cookie']);
  const visitorSessionRaw = Object.entries(queueClient.cookieJar.toObject())
    .filter(([k]) => k.toLowerCase().includes('visitorsession'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  // Extract challengeApiChecksumHash
  const hashMatch = html.match(/challengeApiChecksumHash\s*[=:]\s*["']([^"']+)["']/);
  const challengeHash = hashMatch ? hashMatch[1] : '';
  if (!challengeHash) qlog('  ÔÜá challengeHash introuvable', 'warn');
  else qlog(`  Ô£ô hash extrait`, 'success');

  const queueItBase = `https://${customerId}.queue-it.net`;

  const challengeHeaders = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json',
    Origin: queueItBase,
    Referer: queueItUrl,
    'User-Agent': UA,
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'x-queueit-challange-customerid': customerId,
    'x-queueit-challange-eventid': eventId,
    'x-queueit-challange-hash': challengeHash,
    'Cookie': visitorSessionRaw,
  };

  // ÔöÇÔöÇÔöÇ STEP 3: GET reCAPTCHA challenge ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q2] GET reCAPTCHA challenge...', 'step');
  // Nouvelle URL : /challengeapi/recaptcha/challenge/ (sans customerId/eventId dans le path)
  // Le customerId/eventId sont dans les headers x-queueit-challange-*
  const rcChallengeRes = await queueClient.post(
    `${queueItBase}/challengeapi/recaptcha/challenge/`,
    null,
    {
      headers: {
        ...challengeHeaders,
        'x-requested-with': 'XMLHttpRequest',
        'Content-Type': 'application/json',
      }
    }
  );

  const rcChallenge = rcChallengeRes.data;
  if (!rcChallenge?.sessionId) throw new Error(`Queue-it recaptcha challenge failed: ${JSON.stringify(rcChallenge)}`);
  const rcChallengeDetails = rcChallenge.challengeDetails ?? '';
  const rcSiteKey = rcChallenge.siteKey || '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';

  // ÔöÇÔöÇÔöÇ STEP 4: R├®soudre reCAPTCHA v2 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q3] R├®solution reCAPTCHA v2 ÔÇö Capsolver...', 'step');
  const recaptchaToken = await solveRecaptchaV2(capsolverKey, rcSiteKey, queueItBase, taskId);
  qlog('  Ô£ô reCAPTCHA v2 r├®solu', 'success');

  // ÔöÇÔöÇÔöÇ STEP 5: V├®rifier reCAPTCHA ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q4] POST verify reCAPTCHA...', 'step');
  const rcVerifyRes = await queueClient.post(
    `${queueItBase}/challengeapi/${customerId}/${eventId}/verify`,
    JSON.stringify({
      challengeType: 'Recaptcha',
      sessionId: rcChallenge.sessionId,
      challengeDetails: rcChallengeDetails,
      solution: recaptchaToken,
      stats: {},
      customerId,
      eventId,
      version: 6,
    }),
    { headers: { ...challengeHeaders, 'x-requested-with': 'XMLHttpRequest' } }
  );

  const rcVerify = rcVerifyRes.data;
  if (rcVerify?.challengeFailed) throw new Error('Queue-it: reCAPTCHA verify failed');
  const recaptchaSessionInfo = rcVerify?.sessionInfo;
  qlog('  Ô£ô reCAPTCHA v├®rifi├® par Queue-it', 'success');

  // ÔöÇÔöÇÔöÇ STEP 6: GET PoW challenge ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q5] GET ProofOfWork challenge...', 'step');
  // Nouvelle URL : /challengeapi/pow/challenge/ sans customerId/eventId dans le path
  // La r├®ponse contient DIRECTEMENT la fonction JS (plus besoin d'un GET s├®par├®)
  const powChallengeRes = await queueClient.post(
    `${queueItBase}/challengeapi/pow/challenge/`,
    null,
    { headers: { ...challengeHeaders, 'x-requested-with': 'XMLHttpRequest', 'Content-Type': 'application/json' } }
  );

  const powChallenge = powChallengeRes.data;
  if (!powChallenge?.sessionId) throw new Error(`Queue-it PoW challenge failed: ${JSON.stringify(powChallenge)}`);
  const powChallengeDetails = powChallenge.challengeDetails ?? '';

  // La fonction PoW est directement dans la r├®ponse (champ "function")
  const functionBody: string = powChallenge.function ?? '';
  if (!functionBody) throw new Error('Queue-it: PoW function body vide dans la r├®ponse');
  qlog('  Ô£ô PoW challenge re├ºu', 'success');

  // ÔöÇÔöÇÔöÇ STEP 7b: R├®soudre PoW localement ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog(`  [Q7] R├®solution PoW (runs=${powChallenge.runs}, complexity=${powChallenge.complexity})...`, 'step');
  const { solutionEncoded, durationMs } = await solvePoW(powChallenge, functionBody);
  qlog(`  Ô£ô PoW r├®solu en ${durationMs}ms`, 'success');

  // ÔöÇÔöÇÔöÇ STEP 8: V├®rifier PoW ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q8] POST verify PoW...', 'step');
  const powVerifyRes = await queueClient.post(
    `${queueItBase}/challengeapi/${customerId}/${eventId}/verify`,
    JSON.stringify({
      challengeType: 'ProofOfWork',
      sessionId: powChallenge.sessionId,
      challengeDetails: powChallengeDetails,
      solution: solutionEncoded,
      stats: { durationMs },
      customerId,
      eventId,
      version: 6,
    }),
    { headers: { ...challengeHeaders, 'x-requested-with': 'XMLHttpRequest' } }
  );

  const powVerify = powVerifyRes.data;
  if (powVerify?.challengeFailed) throw new Error('Queue-it: PoW verify failed');
  const powSessionInfo = powVerify?.sessionInfo;
  qlog('  Ô£ô PoW v├®rifi├® par Queue-it', 'success');

  // ÔöÇÔöÇÔöÇ STEP 9: POST enqueue ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  qlog('  [Q9] POST enqueue ÔÇö entr├®e dans la file...', 'step');
  const enqueueUrl = `${queueItBase}/spa-api/queue/${customerId}/${eventId}/enqueue`
    + `?cid=fr-FR&l=${encodeURIComponent('Generic TMFR and partners 2024')}`
    + `&t=${encodeURIComponent(targetUrl)}`
    + `&enqueuetoken=${encodeURIComponent(enqueueToken)}`;

  const enqueueBody = {
    challengeSessions: [recaptchaSessionInfo, powSessionInfo],
    layoutName: 'Generic TMFR and partners 2024',
    customUrlParams: '',
    targetUrl,
    CustomDataEnqueue: null,
    QueueitEnqueueToken: enqueueToken,
    Referrer: '',
  };

  const enqueueRes = await queueClient.post(enqueueUrl, JSON.stringify(enqueueBody), {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      Origin: queueItBase,
      Referer: queueItUrl,
      'x-requested-with': 'XMLHttpRequest',
      'x-queueit-qpage-referral': '',
      'User-Agent': UA,
      'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'x-queueit-challange-customerid': customerId,
      'x-queueit-challange-eventid': eventId,
      'x-queueit-challange-hash': challengeHash,
      'Cookie': visitorSessionRaw,
    },
    skipDelay: true,
  } as any);

  const enqueueData = enqueueRes.data;
  queueClient.cookieJar.ingest(enqueueRes.headers['set-cookie']);

  if (enqueueData?.invalidQueueitEnqueueToken) throw new Error('Queue-it: invalidQueueitEnqueueToken');
  if (!enqueueData?.queueId) throw new Error(`Queue-it: enqueue sans queueId: ${JSON.stringify(enqueueData)}`);

  const queueId: string = enqueueData.queueId;
  qlog(`  Ô£ô Enqueued! ID=${queueId.slice(0, 8)}... ÔÇö polling...`, 'success');

  // ÔöÇÔöÇÔöÇ STEP 10: Polling /status jusqu'├á la redirection ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const seid = crypto.randomUUID();
  const sets = Date.now().toString();
  const layoutName = 'Generic TMFR and partners 2024';
  let layoutVersion = 179115981772;
  let queueItemHeader = enqueueRes.headers['x-queueit-queueitem-v2'] || '';
  let pollCount = 0;
  const POLL_INTERVAL_MS = 10000; // 10 secondes entre chaque poll
  const maxPolls = 6 * 60; // max 1h (6 polls/min ├ù 60 min)

  while (pollCount < maxPolls) {
    if (stopSignal?.stopped) throw new Error('Task arr├¬t├®e par l\'utilisateur');

    pollCount++;
    await sleep(POLL_INTERVAL_MS);

    const statusUrl = `${queueItBase}/spa-api/queue/${customerId}/${eventId}/${queueId}/status`
      + `?cid=fr-FR`
      + `&l=${encodeURIComponent(layoutName)}`
      + `&t=${encodeURIComponent(targetUrl)}`
      + `&enqueuetoken=${encodeURIComponent(enqueueToken)}`
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

    // Log ├á chaque poll (10s = fr├®quence raisonnable)
    qlog(`  ÔÅ│ Position: ${ahead} devant toi${whichIsIn ? ` ┬À ${whichIsIn}` : ''} (${forecast})`, 'queue');

    if (d.redirectUrl && d.isRedirectToTarget) {
      const redirectUrl: string = d.redirectUrl;
      const qtokenMatch = redirectUrl.match(/queueittoken=([^&]+)/);
      const queueittoken = qtokenMatch ? decodeURIComponent(qtokenMatch[1]) : '';

      queueClient.cookieJar.ingest(statusRes.headers['set-cookie']);
      const allCookies = queueClient.cookieJar.toObject();
      const queueItCookieName = Object.keys(allCookies).find(k => k.toLowerCase().includes('queueitaccepted'));
      const queueItCookieValue = queueItCookieName ? allCookies[queueItCookieName] : '';
      const queueItCookie = queueItCookieName ? `${queueItCookieName}=${queueItCookieValue}` : '';

      qlog('  ­ƒÄë File pass├®e! Redirection re├ºue', 'success');
      return { queueItCookie, queueittoken, redirectUrl };
    }
  }

  throw new Error('Queue-it: timeout apr├¿s 1h de polling');
};
