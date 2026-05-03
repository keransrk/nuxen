import { sleep } from '../utils/random.js';
import { directClient } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const CAPSOLVER_URL = 'https://api.capsolver.com';

// reCAPTCHA v3 ÔÇö pour g├®n├®ration des cookies TM (FREvent)
export const solveRecaptchaV3 = async (
  capsolverKey: string,
  taskId: number
): Promise<string> => {
  logger.info(taskId, 'reCAPTCHA v3 ÔÇö Cr├®ation t├óche Capsolver...');

  const createRes = await directClient.post(`${CAPSOLVER_URL}/createTask`, {
    clientKey: capsolverKey,
    task: {
      type: 'ReCaptchaV3TaskProxyless',
      websiteURL: 'https://www.ticketmaster.fr',
      websiteKey: '6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV',
      pageAction: 'FREvent',
      isEnterprise: true,
    },
  }, { skipDelay: true } as any);

  const taskIdCapsolver: string = createRes.data?.taskId;
  if (!taskIdCapsolver) throw new Error(`Capsolver v3 createTask failed: ${JSON.stringify(createRes.data)}`);

  logger.info(taskId, `reCAPTCHA v3 ÔÇö task ${taskIdCapsolver} cr├®├®e, polling...`);

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(attempt === 0 ? 2000 : 3000);
    const res = await directClient.post(`${CAPSOLVER_URL}/getTaskResult`, {
      clientKey: capsolverKey,
      taskId: taskIdCapsolver,
    }, { skipDelay: true } as any);

    if (res.data?.status === 'ready') {
      const token: string = res.data.solution?.gRecaptchaResponse;
      if (!token) throw new Error('Capsolver v3: solution vide');
      logger.success(taskId, 'reCAPTCHA v3 r├®solu');
      return token;
    }
    if (res.data?.status === 'failed') {
      throw new Error(`Capsolver v3 failed: ${res.data.errorDescription}`);
    }
  }
  throw new Error('Capsolver v3 timeout (90s)');
};

// reCAPTCHA v2 ÔÇö pour Queue-it challenge
export const solveRecaptchaV2 = async (
  capsolverKey: string,
  siteKey: string,
  websiteURL: string,
  taskId: number
): Promise<string> => {
  logger.info(taskId, `reCAPTCHA v2 ÔÇö Capsolver (siteKey: ${siteKey.slice(0, 20)}...)`);

  const createRes = await directClient.post(`${CAPSOLVER_URL}/createTask`, {
    clientKey: capsolverKey,
    task: {
      type: 'ReCaptchaV2TaskProxyless',
      websiteURL,
      websiteKey: siteKey,
    },
  }, { skipDelay: true } as any);

  const taskIdCapsolver: string = createRes.data?.taskId;
  if (!taskIdCapsolver) throw new Error(`Capsolver v2 createTask failed: ${JSON.stringify(createRes.data)}`);

  logger.info(taskId, `reCAPTCHA v2 ÔÇö task ${taskIdCapsolver} cr├®├®e, polling...`);

  for (let attempt = 0; attempt < 25; attempt++) {
    await sleep(4000);
    const res = await directClient.post(`${CAPSOLVER_URL}/getTaskResult`, {
      clientKey: capsolverKey,
      taskId: taskIdCapsolver,
    }, { skipDelay: true } as any);

    if (res.data?.status === 'ready') {
      const token: string = res.data.solution?.gRecaptchaResponse;
      if (!token) throw new Error('Capsolver v2: solution vide');
      logger.success(taskId, 'reCAPTCHA v2 r├®solu');
      return token;
    }
    if (res.data?.status === 'failed') {
      throw new Error(`Capsolver v2 failed: ${res.data.errorDescription}`);
    }
  }
  throw new Error('Capsolver v2 timeout (100s)');
};

// reCAPTCHA invisible ÔÇö pour purchase/init TM
// IMPORTANT: le proxy est obligatoire pour que l'IP du token corresponde ├á l'IP de la requ├¬te
export const solveRecaptchaInvisible = async (
  capsolverKey: string,
  taskId: number,
  proxyUrl?: string
): Promise<string> => {
  logger.info(taskId, 'reCAPTCHA invisible ÔÇö Capsolver (purchase/init)...');

  let taskPayload: Record<string, any>;

  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      // Enterprise + proxy pour correspondre ├á l'IP de la requ├¬te TM
      taskPayload = {
        type: 'ReCaptchaV2EnterpriseTask',
        websiteURL: 'https://www.ticketmaster.fr',
        websiteKey: '6LfaC5MUAAAAAGBAhMw9NpXeK_P_19ISJcu1nzC0',
        isInvisible: true,
        proxyType: u.protocol.replace(':', ''),
        proxyAddress: u.hostname,
        proxyPort: parseInt(u.port || '80'),
        proxyLogin: decodeURIComponent(u.username),
        proxyPassword: decodeURIComponent(u.password),
      };
      logger.info(taskId, `reCAPTCHA invisible Enterprise ÔÇö proxy ${u.hostname}:${u.port}`);
    } catch {
      logger.warn(taskId, 'reCAPTCHA invisible ÔÇö proxy URL invalide, fallback proxyless');
      taskPayload = {
        type: 'ReCaptchaV2EnterpriseTaskProxyless',
        websiteURL: 'https://www.ticketmaster.fr',
        websiteKey: '6LfaC5MUAAAAAGBAhMw9NpXeK_P_19ISJcu1nzC0',
        isInvisible: true,
      };
    }
  } else {
    taskPayload = {
      type: 'ReCaptchaV2EnterpriseTaskProxyless',
      websiteURL: 'https://www.ticketmaster.fr',
      websiteKey: '6LfaC5MUAAAAAGBAhMw9NpXeK_P_19ISJcu1nzC0',
      isInvisible: true,
    };
  }

  const createRes = await directClient.post(`${CAPSOLVER_URL}/createTask`, {
    clientKey: capsolverKey,
    task: taskPayload,
  }, { skipDelay: true } as any);

  const taskIdCapsolver: string = createRes.data?.taskId;
  if (!taskIdCapsolver) throw new Error(`Capsolver invisible createTask failed: ${JSON.stringify(createRes.data)}`);

  for (let attempt = 0; attempt < 25; attempt++) {
    await sleep(3000);
    const res = await directClient.post(`${CAPSOLVER_URL}/getTaskResult`, {
      clientKey: capsolverKey,
      taskId: taskIdCapsolver,
    }, { skipDelay: true } as any);

    if (res.data?.status === 'ready') {
      const token: string = res.data.solution?.gRecaptchaResponse;
      if (!token) throw new Error('Capsolver invisible: solution vide');
      logger.success(taskId, 'reCAPTCHA invisible r├®solu');
      return token;
    }
    if (res.data?.status === 'failed') throw new Error(`Capsolver invisible failed: ${res.data.errorDescription ?? ''}`);
  }
  throw new Error('Capsolver invisible timeout (75s)');
};
