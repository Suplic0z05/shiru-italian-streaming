export class TorrentSource {
  url = 'https://www.animeunity.so';
  settings = {};
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": "https://www.animeunity.so/",
    "X-Requested-With": "XMLHttpRequest"
  };

  async single(query) {
    try {
      const title = query?.titles?.[0] || '?';
      const episode = query?.episode || 1;
      
      const apiRes = await fetch(`${this.url}/api/it/anime`, {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title })
      });
      
      let animeInfo = null;
      if (apiRes.ok) {
        const data = await apiRes.json();
        const records = data?.records || data?.data || (Array.isArray(data) ? data : []);
        if (records.length > 0) animeInfo = { id: records[0].id, slug: records[0].slug };
      }
      
      if (!animeInfo) return [];
      
      const epUrl = `${this.url}/it/anime/${animeInfo.id}-${animeInfo.slug}/${episode}`;
      const epRes = await fetch(epUrl, { headers: this.headers });
      if (!epRes.ok) return [];
      const html = await epRes.text();
      
      const videoMatch = html.match(/['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i) || html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
      if (videoMatch) {
        return [{ title: `${title} - Ep ${episode} [AU]`, link: videoMatch[1], seeders: 0, leechers: 0, downloads: 0, accuracy: 'high', hash: `au-${episode}`, size: 0, date: new Date(), type: 'best' }];
      }
      return [];
    } catch (e) { return []; }
  }
  async batch(query) { return []; }
  async movie(query) { return this.single({ ...query, episode: 1 }); }
  async validate() { try { const r = await fetch(this.url, { method: 'HEAD', headers: this.headers }); return r.ok; } catch { return false; } }
}
export default new TorrentSource();
