export class TorrentSource {
  url = 'https://www.animeworld.ac';
  settings = {};
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": "https://www.animeworld.ac/"
  };

  async single(query) {
    try {
      const title = query?.titles?.[0] || '?';
      const episode = query?.episode || 1;
      const res = await fetch(`${this.url}/filter?keyword=${encodeURIComponent(title)}`, { headers: this.headers });
      if (!res.ok) return [];
      const html = await res.text();
      if (html.includes('challenge-platform')) return [];
      
      const match = html.match(/href="\/play\/([^"]+)"/i);
      if (!match) return [];
      const animeLink = `${this.url}/play/${match[1]}`;
      
      const playRes = await fetch(animeLink, { headers: this.headers });
      if (!playRes.ok) return [];
      const playHtml = await playRes.text();
      
      const epRegex = new RegExp(`data-episode-num=["']${episode}["'][^>]*data-id=["'](\\d+)["']`, 'i');
      const epMatch = playHtml.match(epRegex);
      if (!epMatch) return [];
      const episodeId = epMatch[0].match(/data-id=["'](\d+)["']/i)[1];
      
      const apiRes = await fetch(`${this.url}/api/episode/info?id=${episodeId}`, {
        headers: { ...this.headers, 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': animeLink }
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const videoUrl = data?.grabber || data?.url || data?.server?.url;
        if (videoUrl) {
          return [{ title: `${title} - Ep ${episode} [AW]`, link: videoUrl, seeders: 0, leechers: 0, downloads: 0, accuracy: 'high', hash: `aw-${episode}`, size: 0, date: new Date(), type: 'best' }];
        }
      }
      return [];
    } catch (e) { return []; }
  }
  async batch(query) { return []; }
  async movie(query) { return this.single({ ...query, episode: 1 }); }
  async validate() { try { const r = await fetch(this.url, { method: 'HEAD', headers: this.headers }); return r.ok; } catch { return false; } }
}
export default new TorrentSource();
