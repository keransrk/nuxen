import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { sleep } from './random.js';
import { CookieJar } from './cookieJar.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Endpoints that skip the 3s rate limit (time-critical)
const SKIP_DELAY_PATTERNS = [
  '/spa-api/queue/',         // Queue-it status polling
  'api.capsolver.com',       // Capsolver (has its own delay)
  'discord.com/api/webhooks', // Discord
];

const shouldSkipDelay = (url: string): boolean =>
  SKIP_DELAY_PATTERNS.some(p => url.includes(p));

export interface HttpClientOptions {
  proxyUrl?: string;
  cookieJar?: CookieJar;
  delayMs?: number;   // default 3000
  taskId?: number;
}

export class HttpClient {
  private proxyUrl?: string;
  public cookieJar: CookieJar;
  private delayMs: number;
  private lastRequestTime: number = 0;
  private agent?: HttpsProxyAgent<string>;

  constructor(opts: HttpClientOptions = {}) {
    this.proxyUrl = opts.proxyUrl;
    this.cookieJar = opts.cookieJar ?? new CookieJar();
    this.delayMs = opts.delayMs ?? 3000;
    if (this.proxyUrl) {
      this.agent = new HttpsProxyAgent(this.proxyUrl);
    }
  }

  private async applyRateLimit(url: string) {
    if (shouldSkipDelay(url)) return;
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.delayMs) {
      await sleep(this.delayMs - elapsed);
    }
  }

  async request<T = any>(config: AxiosRequestConfig & { skipDelay?: boolean }): Promise<AxiosResponse<T>> {
    const url = (config.url ?? '').toString();

    if (!config.skipDelay) {
      await this.applyRateLimit(url);
    }
    this.lastRequestTime = Date.now();

    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      ...config.headers as Record<string, string>,
    };

    // Auto-inject Cookie header from jar if not already set
    const cookieHeader = this.cookieJar.toString();
    if (cookieHeader && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = cookieHeader;
    }

    const axiosConfig: AxiosRequestConfig = {
      ...config,
      headers,
      httpsAgent: this.agent,
      httpAgent: this.agent,
      validateStatus: () => true,
      maxRedirects: config.maxRedirects ?? 5,
      // Priorité : timeout du config, sinon 15s par défaut (était 30s hardcodé)
      timeout: config.timeout ?? 15000,
    };

    const res = await axios(axiosConfig);

    // Auto-ingest response cookies
    const setCookie = res.headers['set-cookie'];
    if (setCookie) this.cookieJar.ingest(setCookie);

    return res;
  }

  // Convenience methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }
}

// Direct (no proxy) client ÔÇö for Capsolver
export const directClient = new HttpClient({ delayMs: 0 });
