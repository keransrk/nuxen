export class CookieJar {
  private jar: Map<string, string> = new Map();

  set(name: string, value: string) {
    this.jar.set(name.trim(), value.trim());
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  // Ingest raw Set-Cookie header values (array or single string)
  ingest(setCookieHeaders: string | string[] | undefined) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const raw of headers) {
      if (!raw) continue;
      const [nameVal] = raw.split(';');
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx < 0) continue;
      const name = nameVal.substring(0, eqIdx).trim();
      const value = nameVal.substring(eqIdx + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }

  // Build Cookie header string from jar + optional extra string
  buildHeader(extra?: string): string {
    const parts = Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`);
    if (extra) {
      // Parse extra string and merge (without duplicating)
      const existingKeys = new Set(this.jar.keys());
      for (const pair of extra.split(';')) {
        const idx = pair.indexOf('=');
        if (idx < 0) continue;
        const k = pair.substring(0, idx).trim();
        if (!existingKeys.has(k)) parts.push(pair.trim());
      }
    }
    return parts.join('; ');
  }

  // Inject a raw "key=value; key=value" cookie string into the jar
  ingestString(cookieString: string) {
    for (const pair of cookieString.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      this.jar.set(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
    }
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.jar);
  }

  toString(): string {
    return this.buildHeader();
  }

  clone(): CookieJar {
    const c = new CookieJar();
    for (const [k, v] of this.jar) c.set(k, v);
    return c;
  }
}
