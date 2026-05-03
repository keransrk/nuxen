import { HttpClient } from '../utils/http.js';
import { solveRecaptchaV3 } from './recaptcha.js';
import { logger } from '../utils/logger.js';

const TM_BASE = 'https://www.ticketmaster.fr';
const RECAPTCHA_SITE_KEY = '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV';

export interface TmCookies {
  eps_sid: string;
  SID: string;
  BID: string;
  tmpt: string;
  cookieString: string;
  ok: boolean;
  fetchedAt: string;
}

export const generateCookies = async (
  capsolverKey: string,
  proxyUrl: string,
  taskId: number
): Promise<TmCookies> => {
  // delayMs: 0 pour la g├®n├®ration cookies ÔÇö requ├¬tes auth, pas du scraping
  const client = new HttpClient({ proxyUrl, delayMs: 0 });

  // ÔöÇÔöÇÔöÇ Step 1: GET /eps-mgr ÔåÆ extraire epsfToken ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  logger.info(taskId, 'G├®n├®ration cookies ÔÇö GET /eps-mgr...');
  const epsRes = await client.get(`${TM_BASE}/eps-mgr`, {
    headers: {
      Accept: '*/*',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `${TM_BASE}/fr`,
      'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  const body = typeof epsRes.data === 'string' ? epsRes.data : JSON.stringify(epsRes.data);
  const match = body.match(/var epsfToken\s*=\s*'([^']+)'/);
  if (!match) throw new Error('epsfToken introuvable dans /eps-mgr ÔÇö proxy invalide ou bloqu├®');

  const eps_sid = match[1];
  logger.info(taskId, `eps_sid extrait: ${eps_sid.slice(0, 30)}...`);

  // ÔöÇÔöÇÔöÇ Step 2: R├®soudre reCAPTCHA v3 ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const recaptchaToken = await solveRecaptchaV3(capsolverKey, taskId);

  // ÔöÇÔöÇÔöÇ Step 3: POST /epsf/gec/v3/FREvent ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  logger.info(taskId, 'G├®n├®ration cookies ÔÇö POST /epsf/gec/v3/FREvent...');
  const gecRes = await client.post(
    `${TM_BASE}/epsf/gec/v3/FREvent`,
    JSON.stringify({
      hostname: 'www.ticketmaster.fr',
      key: RECAPTCHA_SITE_KEY,
      token: recaptchaToken,
    }),
    {
      headers: {
        Accept: '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Content-Type': 'application/json',
        Origin: TM_BASE,
        Referer: `${TM_BASE}/fr`,
        'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
    }
  );

  // ÔöÇÔöÇÔöÇ Step 4: Assembler les cookies ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  const jar = client.cookieJar.toObject();
  const SID = jar['SID'] || '';
  const BID = jar['BID'] || '';
  const tmpt = jar['tmpt'] || '';

  const missing = ['SID', 'BID', 'tmpt'].filter(n => !jar[n]);
  if (missing.length > 0) {
    logger.warn(taskId, `Cookies manquants: ${missing.join(', ')} ÔÇö statut gec: ${gecRes.status}`);
  }

  const cookieString = `eps_sid=${eps_sid}; SID=${SID}; BID=${BID}; tmpt=${tmpt}`;

  if (missing.length === 0) {
    logger.success(taskId, 'Cookies TM g├®n├®r├®s avec succ├¿s');
  }

  return {
    eps_sid,
    SID,
    BID,
    tmpt,
    cookieString,
    ok: missing.length === 0,
    fetchedAt: new Date().toISOString(),
  };
};
