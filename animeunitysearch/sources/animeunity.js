/**
 * Estensione AnimeUnity per Shiru
 * Sito: https://www.animeunity.so/
 */
export class TorrentSource {
  url = 'https://www.animeunity.so';
  settings = {};
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, application/xhtml+xml, */*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": "https://www.animeunity.so/",
    "X-Requested-With": "XMLHttpRequest"
  };

  async single(query) {
    try {
      const titles = query?.titles ?? [];
      const title = titles[0] || '?';
      const episode = query?.episode || 1;

      const animeInfo = await this.searchViaApi(title);
      if (!animeInfo) {
        console.log("[AnimeUnity] Nessun risultato per:", title);
        return [];
      }
      console.log("[AnimeUnity] Anime trovato:", animeInfo.id, animeInfo.slug);

      const videoUrl = await this.getVideoUrl(animeInfo, episode);
      if (!videoUrl) {
        console.log(`[AnimeUnity] Video non trovato per ep ${episode}`);
        return [];
      }

      return [{
        title: `${title} - Episodio ${episode} [AnimeUnity]`,
        link: videoUrl,
        seeders: 0,
        leechers: 0,
        downloads: 0,
        accuracy: 'high',
        hash: `animeunity-${episode}-${Date.now()}`,
        size: 0,
        date: new Date(),
        type: 'best'
      }];
    } catch (error) {
      console.error("[AnimeUnity] Errore:", error.message);
      return [];
    }
  }

  async batch(query) {
    try {
      const title = query?.titles?.[0] || '?';
      const episodeCount = query?.episodeCount || 12;
      const results = [];

      const animeInfo = await this.searchViaApi(title);
      if (!animeInfo) return [];

      for (let ep = 1; ep <= episodeCount; ep++) {
        try {
          const videoUrl = await this.getVideoUrl(animeInfo, ep);
          if (videoUrl) {
            results.push({
              title: `${title} - Episodio ${ep} [AnimeUnity]`,
              link: videoUrl,
              seeders: 0,
              leechers: 0,
              downloads: 0,
              accuracy: 'high',
              hash: `animeunity-batch-${ep}-${Date.now()}`,
              size: 0,
              date: new Date(),
              type: 'batch'
            });
          }
        } catch (e) {
          console.log(`[AnimeUnity] Ep ${ep} non disponibile`);
        }
      }
      return results;
    } catch (error) {
      console.error("[AnimeUnity] Errore batch:", error.message);
      return [];
    }
  }

  async movie(query) {
    return this.single({ ...query, episode: 1 });
  }

  async validate() {
    try {
      const r = await fetch(this.url, { method: 'HEAD', headers: this.headers });
      return r.ok;
    } catch { return false; }
  }

  async searchViaApi(title) {
    try {
      const apiUrl = `${this.url}/api/it/anime`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ title: title })
      });
      if (response.ok) {
        const data = await response.json();
        const records = data?.records || data?.data || (Array.isArray(data) ? data : []);
        if (records.length > 0) {
          const first = records[0];
          return { id: first.id, slug: first.slug };
        }
      }
    } catch (e) {
      console.log("[AnimeUnity] API POST fallita, provo fallback HTML:", e.message);
    }

    try {
      const pageUrl = `${this.url}/archivio?title=${encodeURIComponent(title)}`;
      const response = await fetch(pageUrl, { headers: this.headers });
      if (response.ok) {
        const html = await response.text();

        const dataMatch = html.match(
          /window\.__INITIAL_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/i
        );
        if (dataMatch) {
          try {
            const data = JSON.parse(dataMatch[1]);
            const records = data?.records || data?.anime || [];
            if (records.length > 0) {
              return { id: records[0].id, slug: records[0].slug };
            }
          } catch (parseErr) {
            console.log("[AnimeUnity] Errore parsing JSON embedded:", parseErr.message);
          }
        }

        const jsonRegex = /"id"\s*:\s*(\d+)\s*,\s*"slug"\s*:\s*"([^"]+)"/gi;
        const matches = [...html.matchAll(jsonRegex)];
        if (matches.length > 0) {
          return { id: matches[0][1], slug: matches[0][2] };
        }
      }
    } catch (e) {
      console.log("[AnimeUnity] Fallback HTML fallito:", e.message);
    }

    return null;
  }

  async getVideoUrl(animeInfo, episode) {
    const episodeUrl = `${this.url}/it/anime/${animeInfo.id}-${animeInfo.slug}/${episode}`;
    console.log("[AnimeUnity] Fetch episodio:", episodeUrl);

    try {
      const response = await fetch(episodeUrl, { headers: this.headers });
      if (!response.ok) return null;
      const html = await response.text();

      const m3u8Regex = /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/gi;
      const m3u8Matches = [...html.matchAll(m3u8Regex)];
      if (m3u8Matches.length > 0) {
        return m3u8Matches[0][1];
      }

      const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
      for (const m of [...html.matchAll(iframeRegex)]) {
        const embedUrl = m[1];
        if (embedUrl.includes('vixcloud') || embedUrl.includes('stream')) {
          try {
            const embedResp = await fetch(embedUrl, {
              headers: { ...this.headers, Referer: episodeUrl }
            });
            const embedHtml = await embedResp.text();
            const embedM3u8 = embedHtml.match(/['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i);
            if (embedM3u8) return embedM3u8[1];
            return embedUrl;
          } catch (e) {
            console.log("[AnimeUnity] Errore embed:", e.message);
          }
        }
      }

      const sourceRegex = /"src"\s*:\s*"(https?:\/\/[^"]+)"/gi;
      const sourceMatches = [...html.matchAll(sourceRegex)];
      if (sourceMatches.length > 0) {
        return sourceMatches[0][1];
      }
    } catch (e) {
      console.log("[AnimeUnity] Errore fetch episodio:", e.message);
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
