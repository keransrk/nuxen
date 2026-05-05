/**
 * Akamai Bot Manager bypass via Playwright (headless Chromium).
 *
 * Instead of trying to execute Akamai's obfuscated script in a fragile Node.js VM,
 * we navigate to the Queue-it page in a real headless Chrome instance.
 * This guarantees that Akamai's fingerprinting runs in a legitimate browser
 * environment, producing valid sensor_data that Akamai will accept.
 *
 * Flow:
 * 1. Launch headless Chromium (with proxy if provided).
 * 2. Set pre-existing session cookies on the context.
 * 3. Navigate to the Queue-it /view URL.
 * 4. Intercept the Akamai sensor_data POST via route interception.
 * 5. Wait for sensor_data capture + give the browser time to receive the
 *    validated _abck cookie back.
 * 6. Extract all cookies from the browser and return them to the caller so
 *    that steps.ts can merge them into the main session cookie jar.
 */

import { chromium } from 'playwright';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

type LogFn = (msg: string, level?: string) => void;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

/**
 * Kept for compatibility with steps.ts — scans the /view HTML for a known
 * Akamai injection script path. Returns null if not found.
 */
export const findAkamaiScriptPath = (html: string): string | null => {
  const re = /<script[^>]+src="(\/[A-Za-z0-9_-]{4,14}\/[A-Za-z0-9_-]{4,14}\/[A-Za-z0-9_\/-]{10,})"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (
      !path.startsWith('/static') &&
      !path.startsWith('/view') &&
      !path.startsWith('/spa-api') &&
      !path.startsWith('/challengeapi') &&
      !path.includes('queue-it') &&
      !path.includes('assets')
    ) {
      return path;
    }
  }
  return null;
};

interface AkamaiBypassResult {
  success: boolean;
  /** All cookies extracted from the Playwright browser (to merge into main jar) */
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  sensorData?: string;
  error?: string;
}

/**
 * Run the Akamai bypass in a headless Chromium browser.
 *
 * @param queueItViewUrl  - The full Queue-it /view URL to navigate to.
 * @param proxyUrl        - Optional HTTP proxy (http://user:pass@host:port).
 * @param initialCookies  - Cookies to pre-seed (from the current session jar).
 * @param log             - Logging callback.
 * @returns               - Result with cookies to merge and optional sensor_data.
 */
const runAkamaiPlaywright = async (
  queueItViewUrl: string,
  proxyUrl: string,
  initialCookies: Array<{ name: string; value: string; domain: string; path: string }>,
  log: LogFn,
): Promise<AkamaiBypassResult> => {
  let browser = null;

  try {
    const parsedProxy = proxyUrl ? new URL(proxyUrl) : null;

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--lang=fr-FR',
      ],
      ...(parsedProxy ? {
        proxy: {
          server: `${parsedProxy.protocol}//${parsedProxy.hostname}:${parsedProxy.port}`,
          username: parsedProxy.username || undefined,
          password: parsedProxy.password || undefined,
        },
      } : {}),
    });

    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      ignoreHTTPSErrors: true,
    });

    // Pre-seed session cookies
    if (initialCookies.length > 0) {
      // Playwright requires the `url` or `domain` field
      const playwrightCookies = initialCookies
        .filter(c => c.domain && c.name && c.value)
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
          path: c.path || '/',
        }));
      if (playwrightCookies.length > 0) {
        await context.addCookies(playwrightCookies);
      }
    }

    const page = await context.newPage();

    let sensorData: string | null = null;
    let sensorDataResolve: (v: string | null) => void;
    const sensorDataPromise = new Promise<string | null>(r => { sensorDataResolve = r; });

    // Intercept all network requests to capture Akamai sensor_data POST
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && !sensorData) {
        try {
          const body = request.postData();
          if (body) {
            let parsed: Record<string, unknown> | null = null;
            try { parsed = JSON.parse(body); } catch { /* not json */ }
            if (parsed?.sensor_data && typeof parsed.sensor_data === 'string') {
              sensorData = parsed.sensor_data;
              sensorDataResolve(sensorData);
              log('  [Q0c] Akamai Playwright: sensor_data intercepte', 'step');
            }
          }
        } catch { /* ignore */ }
      }
      await route.continue();
    });

    log('  [Q0a] Akamai Playwright: navigation vers Queue-it...', 'step');

    await page.goto(queueItViewUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Attendre sensor_data OU 8s (réduit pour les cas CDN où il n'y a pas de sensor_data JS)
    await Promise.race([
      sensorDataPromise,
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ]);

    // Chercher et cliquer sur un bouton "Accéder à la salle d'attente" si présent
    // (certains events Queue-it affichent ce bouton avant de montrer le challenge)
    const enterSelectors = [
      '#MainPart_btnAcceptTermsAndJoinQueue',
      '#btnJoinWaitingRoom',
      'button[data-pageid="before"]',
      'button.join-queue',
    ];
    let buttonClicked = false;
    for (const sel of enterSelectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          const isVis = await page.locator(sel).first().isVisible();
          if (isVis) {
            log(`  [Q0b] Playwright: bouton detecte (${sel}) → clic`, 'step');
            await page.locator(sel).first().click({ timeout: 3000 });
            await page.waitForTimeout(3000);
            buttonClicked = true;
            break;
          }
        }
      } catch { /* bouton non visible, on continue */ }
    }
    // Fallback : chercher des textes courants si aucun sélecteur précis trouvé
    if (!buttonClicked) {
      for (const txt of ['Accéder', 'Acceder', 'Entrer', 'Enter', 'Join']) {
        try {
          const btn = page.getByRole('button', { name: new RegExp(txt, 'i') });
          const count = await btn.count();
          if (count > 0 && await btn.first().isVisible()) {
            log(`  [Q0b] Playwright: bouton texte "${txt}" detecte → clic`, 'step');
            await btn.first().click({ timeout: 3000 });
            await page.waitForTimeout(3000);
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Laisser le temps à Akamai de traiter la réponse et mettre à jour _abck
    await page.waitForTimeout(2000);

    const allCookies = await context.cookies();

    await browser.close();
    browser = null;

    const cookies = allCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
    }));

    const abck = allCookies.find(c => c.name === '_abck');
    const bmSz = allCookies.find(c => c.name === 'bm_sz');
    const visitorsession = allCookies.find(c => c.name?.toLowerCase().includes('visitorsession'));
    const hasUsefulCookies = !!(abck || sensorData || bmSz || (cookies.length > 0 && visitorsession));

    if (hasUsefulCookies) {
      const captured = [abck ? '_abck' : null, sensorData ? 'sensor_data' : null, bmSz ? 'bm_sz' : null]
        .filter(Boolean).join(', ') || `${cookies.length} cookies`;
      log(`  [OK] Playwright: ${captured} capturé(s)`, 'success');
      return { success: true, cookies, sensorData: sensorData ?? undefined };
    } else {
      return {
        success: false,
        cookies,
        error: 'Aucun cookie utile capturé (pas de _abck, bm_sz ou sensor_data)',
      };
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (browser) {
      try { await (browser as Awaited<ReturnType<typeof chromium.launch>>).close(); } catch { /* ignore */ }
    }
    return { success: false, cookies: [], error: msg };
  }
};

/**
 * Full Akamai Playwright bypass.
 * Called by steps.ts when Akamai is detected on the Queue-it page.
 *
 * @param html             - The /view HTML (used to detect Akamai presence).
 * @param queueItBase      - Base URL of the Queue-it domain (e.g. https://wait.ticketmaster.fr).
 * @param queueItViewUrl   - Full /view URL.
 * @param userAgent        - User-Agent string.
 * @param cookieHeader     - Current Cookie header string.
 * @param proxyUrl         - Proxy URL.
 * @param log              - Logging callback.
 * @param onCookiesMerge   - Callback to merge Playwright cookies back into the session jar.
 * @returns                - true on success, false on failure.
 */
export const runAkamaiVmBypass = async (
  html: string,
  queueItBase: string,
  queueItViewUrl: string,
  userAgent: string,
  cookieHeader: string,
  proxyUrl: string,
  log: LogFn,
  onCookiesMerge?: (cookies: Array<{ name: string; value: string; domain: string; path: string }>) => void,
): Promise<boolean> => {
  // Parse initial cookies from cookieHeader string into structured objects
  const domainHost = (() => {
    try { return new URL(queueItViewUrl).hostname; } catch { return 'wait.ticketmaster.fr'; }
  })();

  const initialCookies = cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) return null;
      return {
        name: part.slice(0, eqIdx).trim(),
        value: part.slice(eqIdx + 1).trim(),
        domain: domainHost,
        path: '/',
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const result = await runAkamaiPlaywright(
    queueItViewUrl,
    proxyUrl,
    initialCookies,
    log,
  );

  if (result.cookies.length > 0 && onCookiesMerge) {
    onCookiesMerge(result.cookies);
  }

  if (!result.success) {
    log(`  [!] Akamai Playwright: ${result.error ?? 'echec inconnu'}`, 'warn');
    return false;
  }

  // If sensor_data was captured but wasn't auto-submitted by Akamai's script
  // (e.g. because Playwright intercepted it before the XHR completed),
  // submit it manually via our proxy to validate the _abck cookie server-side.
  if (result.sensorData) {
    const akamaiPath = findAkamaiScriptPath(html);
    if (akamaiPath) {
      const akamaiEndpointUrl = `${queueItBase}${akamaiPath}`;
      const agent = new HttpsProxyAgent(proxyUrl);
      try {
        await axios.post(
          akamaiEndpointUrl,
          JSON.stringify({ sensor_data: result.sensorData }),
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: '*/*',
              'User-Agent': userAgent,
              Referer: queueItViewUrl,
              Cookie: cookieHeader,
            },
            httpsAgent: agent,
            timeout: 10000,
            validateStatus: () => true,
          },
        );
        log('  [OK] Akamai Playwright: sensor_data soumis via proxy', 'success');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`  [~] Akamai Playwright: POST sensor_data echoue (${msg})`, 'warn');
      }
    }
  }

  return true;
};
