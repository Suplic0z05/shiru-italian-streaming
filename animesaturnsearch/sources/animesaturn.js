/**
 * Estensione AnimeSaturn per Shiru
 * Sito: https://www.animesaturn.net/
 */
export class TorrentSource {
  constructor() {
    this.url = 'https://www.animesaturn.net';
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "it-IT,it;q=0.9",
      "Referer": "https://www.animesaturn.net/"
    };
  }

  async single(query) {
    try {
      const titles = query?.titles ?? [];
      const title = titles[0] || '?';
      const episode = query?.episode || 1;

      // Endpoint corretto per la ricerca
      const searchUrl = `${this.url}/animelist?search=${encodeURIComponent(title)}`;
      console.log("[AnimeSaturn] Ricerca:", searchUrl);

      const searchResponse = await fetch(searchUrl, { headers: this.headers });
      if (!searchResponse.ok) {
        console.log("[AnimeSaturn] Errore HTTP ricerca:", searchResponse.status);
        return [];
      }
      const searchHtml = await searchResponse.text();

      const animeSlug = this.extractAnimeSlug(searchHtml);
      if (!animeSlug) {
        console.log("[AnimeSaturn] Nessun risultato per:", title);
        return [];
      }
      console.log("[AnimeSaturn] Slug trovato:", animeSlug);

      // Pagina dell'anime con la lista episodi
      const animePageUrl = `${this.url}/anime/${animeSlug}`;
      const animeResponse = await fetch(animePageUrl, { headers: this.headers });
      if (!animeResponse.ok) return [];
      const animeHtml = await animeResponse.text();

      // Estrae il link specifico dell'episodio
      const episodePath = this.extractEpisodePath(animeHtml, episode);
      if (!episodePath) {
        console.log(`[AnimeSaturn] Episodio ${episode} non trovato nella lista`);
        return [];
      }

      const episodeUrl = episodePath.startsWith('http')
        ? episodePath
        : `${this.url}${episodePath}`;

      const episodeResponse = await fetch(episodeUrl, { headers: this.headers });
      if (!episodeResponse.ok) return [];
      const episodeHtml = await episodeResponse.text();

      const videoUrl = await this.extractVideoUrl(episodeHtml, episodeUrl);
      if (!videoUrl) {
        console.log("[AnimeSaturn] Impossibile estrarre URL video");
        return [];
      }

      return [{
        title: `${title} - Episodio ${episode} [AnimeSaturn]`,
        link: videoUrl,
        seeders: 0,
        leechers: 0,
        downloads: 0,
        accuracy: 'high',
        hash: `animesaturn-${episode}-${Date.now()}`,
        size: 0,
        date: new Date(),
        type: 'best'
      }];
    } catch (error) {
      console.error("[AnimeSaturn] Errore:", error.message);
      return [];
    }
  }

  async batch(query) {
    try {
      const title = query?.titles?.[0] || '?';
      const episodeCount = query?.episodeCount || 12;
      const results = [];

      const searchUrl = `${this.url}/animelist?search=${encodeURIComponent(title)}`;
      const searchResponse = await fetch(searchUrl, { headers: this.headers });
      if (!searchResponse.ok) return [];
      const searchHtml = await searchResponse.text();
      const animeSlug = this.extractAnimeSlug(searchHtml);
      if (!animeSlug) return [];

      const animePageUrl = `${this.url}/anime/${animeSlug}`;
      const animeResponse = await fetch(animePageUrl, { headers: this.headers });
      if (!animeResponse.ok) return [];
      const animeHtml = await animeResponse.text();

      for (let ep = 1; ep <= episodeCount; ep++) {
        try {
          const episodePath = this.extractEpisodePath(animeHtml, ep);
          if (!episodePath) continue;

          const episodeUrl = episodePath.startsWith('http')
            ? episodePath : `${this.url}${episodePath}`;
          const response = await fetch(episodeUrl, { headers: this.headers });
          if (!response.ok) continue;

          const html = await response.text();
          const videoUrl = await this.extractVideoUrl(html, episodeUrl);
          if (videoUrl) {
            results.push({
              title: `${title} - Episodio ${ep} [AnimeSaturn]`,
              link: videoUrl,
              seeders: 0,
              leechers: 0,
              downloads: 0,
              accuracy: 'high',
              hash: `animesaturn-batch-${ep}-${Date.now()}`,
              size: 0,
              date: new Date(),
              type: 'batch'
            });
          }
        } catch (e) {
          console.log(`[AnimeSaturn] Ep ${ep} non disponibile`);
        }
      }
      return results;
    } catch (error) {
      console.error("[AnimeSaturn] Errore batch:", error.message);
      return [];
    }
  }

  async movie(query) {
    return this.single({ ...query, episode: 1 });
  }

  async validate() {
    try {
      const response = await fetch(this.url, { method: 'HEAD', headers: this.headers });
      return response.ok;
    } catch { return false; }
  }

  extractAnimeSlug(html) {
    const decoded = this.decodeEntities(html);
    // Pattern: href="/anime/SLUG"
    const regex = /href="\/anime\/([^"]+)"[^>]*>/gi;
    const matches = [...decoded.matchAll(regex)];
    return matches.length > 0 ? matches[0][1] : null;
  }

  extractEpisodePath(animeHtml, episode) {
    const decoded = this.decodeEntities(animeHtml);
    
    // Pattern 1: href="/ep/SLUG-ep-N"
    const regex1 = new RegExp(`href="(/ep/[^"]+-ep-${episode})"`, 'gi');
    const match1 = decoded.match(regex1);
    if (match1) {
      const href = match1[0].match(/href="([^"]+)"/i);
      if (href) return href[1];
    }
    
    // Pattern 2: href="/ep/SLUG-EPN" (senza trattino)
    const regex2 = new RegExp(`href="(/ep/[^"]+[-]?(?:ep)?${episode})"`, 'gi');
    const match2 = decoded.match(regex2);
    if (match2) {
      const href = match2[0].match(/href="([^"]+)"/i);
      if (href) return href[1];
    }
    return null;
  }

  async extractVideoUrl(html, refererUrl) {
    const decoded = this.decodeEntities(html);
    const BLOCKED = ['youtube.com', 'youtu.be', 'dailymotion.com', 'a-ads.com', 'adsterra', 'propellerads', 'popads'];
    const isBlocked = (u) => BLOCKED.some(h => u.includes(h));

    // Cerca link alla pagina /watch/ (spesso il vero player è lì)
    const watchRegex = /href="\/watch\/([^"]+)"/gi;
    const watchMatches = [...decoded.matchAll(watchRegex)];
    if (watchMatches.length > 0) {
      const watchUrl = `${this.url}/watch/${watchMatches[0][1]}`;
      try {
        const watchResp = await fetch(watchUrl, {
          headers: { ...this.headers, Referer: refererUrl }
        });
        const watchHtml = await watchResp.text();
        return this._findVideoInHtml(watchHtml, isBlocked);
      } catch (e) {
        console.error("[AnimeSaturn] Errore fetch watch:", e.message);
      }
    }

    return this._findVideoInHtml(decoded, isBlocked);
  }

  _findVideoInHtml(html, isBlocked) {
    // iframe embed
    const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
    for (const m of [...html.matchAll(iframeRegex)]) {
      if (!isBlocked(m[1])) return m[1];
    }
    
    // URL diretti
    const patterns = [
      /['"](https?:\/\/[^"']+\.mp4[^"']*)['"]/i,
      /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i,
      /file:\s*['"](https?:\/\/[^"']+)['"]/i,
      /source:\s*['"](https?:\/\/[^"']+)['"]/i
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1] && !isBlocked(m[1])) return m[1];
    }
    return null;
  }

  decodeEntities(str) {
    return (str || '')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#x3D;/g, '=')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}
export default new TorrentSource();
