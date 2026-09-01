/**
 * Estensione AnimeWorld per Shiru
 * Sito: https://www.animeworld.ac/
 * NOTA: Tutti gli episodi sono nella stessa pagina /play/.
 * Il video si ottiene via API interna.
 */
export class TorrentSource {
    url = 'https://www.animeworld.ac';
    settings = {};
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": this.url
    };

    async single(query) {
        try {
            const titles = query?.titles ?? [];
            const title = titles[0] || '?';
            const episode = query?.episode || 1;

            const searchUrl = `${this.url}/filter?keyword=${encodeURIComponent(title)}`;
            console.log("[AnimeWorld] Ricerca:", searchUrl);

            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            if (!searchResponse.ok) {
                console.error("[AnimeWorld] Errore HTTP:", searchResponse.status);
                return [];
            }
            const searchHtml = await searchResponse.text();

            // Verifica se Cloudflare ha bloccato la richiesta
            if (searchHtml.includes('challenge-platform') || searchHtml.includes('cf-browser-verification')) {
                console.error("[AnimeWorld] Bloccato da Cloudflare");
                return [];
            }

            const animeLink = this.extractAnimeLink(searchHtml);
            if (!animeLink) {
                console.log("[AnimeWorld] Nessun risultato per:", title);
                return [];
            }
            console.log("[AnimeWorld] Anime trovato:", animeLink);

            // CORREZIONE: fetch della pagina /play/ (tutti gli episodi sono qui)
            const playResponse = await fetch(animeLink, { headers: this.headers });
            if (!playResponse.ok) return [];
            const playHtml = await playResponse.text();

            // CORREZIONE: estrae l'ID dell'episodio specifico
            const episodeId = this.extractEpisodeId(playHtml, episode);
            if (!episodeId) {
                console.log(`[AnimeWorld] Episodio ${episode} non trovato`);
                return [];
            }

            // CORREZIONE: ottiene il video tramite API interna
            const videoUrl = await this.getVideoFromApi(episodeId, animeLink);
            if (!videoUrl) {
                // Fallback: cerca direttamente nell'HTML
                const fallbackUrl = this.extractVideoUrl(playHtml);
                if (!fallbackUrl) {
                    console.log("[AnimeWorld] Impossibile estrarre URL video");
                    return [];
                }
                return [this._buildResult(title, episode, fallbackUrl)];
            }

            return [this._buildResult(title, episode, videoUrl)];
        } catch (error) {
            console.error("[AnimeWorld] Errore:", error.message);
            return [];
        }
    }

    async batch(query) {
        try {
            const title = query?.titles?.[0] || '?';
            const episodeCount = query?.episodeCount || 12;
            const results = [];

            const searchUrl = `${this.url}/filter?keyword=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            if (!searchResponse.ok) return [];
            const searchHtml = await searchResponse.text();
            const animeLink = this.extractAnimeLink(searchHtml);
            if (!animeLink) return [];

            const playResponse = await fetch(animeLink, { headers: this.headers });
            if (!playResponse.ok) return [];
            const playHtml = await playResponse.text();

            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const episodeId = this.extractEpisodeId(playHtml, ep);
                    if (!episodeId) continue;

                    const videoUrl = await this.getVideoFromApi(episodeId, animeLink)
                        || this.extractVideoUrl(playHtml);
                    if (videoUrl) {
                        results.push({
                            title: `${title} - Episodio ${ep} [AnimeWorld]`,
                            link: videoUrl,
                            seeders: 0, leechers: 0, downloads: 0,
                            accuracy: 'high',
                            hash: `animeworld-batch-${ep}-${Date.now()}`,
                            size: 0, date: new Date(), type: 'batch'
                        });
                    }
                } catch (e) {
                    console.log(`[AnimeWorld] Ep ${ep} non disponibile`);
                }
            }
            return results;
        } catch (error) {
            console.error("[AnimeWorld] Errore batch:", error.message);
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

    _buildResult(title, episode, videoUrl) {
        return {
            title: `${title} - Episodio ${episode} [AnimeWorld]`,
            link: videoUrl,
            seeders: 0, leechers: 0, downloads: 0,
            accuracy: 'high',
            hash: `animeworld-${episode}-${Date.now()}`,
            size: 0, date: new Date(), type: 'best'
        };
    }

    extractAnimeLink(html) {
        const regex = /href="\/play\/([^"]+)"/gi;
        const matches = [...html.matchAll(regex)];
        return matches.length > 0 ? `${this.url}/play/${matches[0][1]}` : null;
    }

    // NUOVO: estrae l'ID dell'episodio dalla pagina play
    extractEpisodeId(html, episode) {
        const decoded = this.decodeEntities(html);
        // Pattern 1: data-episode-num="N" ... data-id="ID"
        const regex1 = new RegExp(
            `data-episode-num=["']${episode}["'][^>]*data-id=["'](\\d+)["']`, 'gi'
        );
        const m1 = decoded.match(regex1);
        if (m1) {
            const idMatch = m1[0].match(/data-id=["'](\d+)["']/i);
            if (idMatch) return idMatch[1];
        }
        // Pattern 2: ordine inverso degli attributi
        const regex2 = new RegExp(
            `data-id=["'](\\d+)["'][^>]*data-episode-num=["']${episode}["']`, 'gi'
        );
        const m2 = decoded.match(regex2);
        if (m2) {
            const idMatch = m2[0].match(/data-id=["'](\d+)["']/i);
            if (idMatch) return idMatch[1];
        }
        // Pattern 3: cerca in elementi con class "episode" e testo del numero
        const regex3 = new RegExp(
            `<a[^>]*class=["'][^"']*episode[^"']*["'][^>]*data-id=["'](\\d+)["'][^>]*>[^<]*${episode}[^<]*<\\/a>`, 'gi'
        );
        const m3 = decoded.match(regex3);
        if (m3) {
            const idMatch = m3[0].match(/data-id=["'](\d+)["']/i);
            if (idMatch) return idMatch[1];
        }
        return null;
    }

    // NUOVO: ottiene il video dall'API interna di AnimeWorld
    async getVideoFromApi(episodeId, referer) {
        try {
            const apiUrl = `${this.url}/api/episode/info?id=${episodeId}`;
            console.log("[AnimeWorld] API episodio:", apiUrl);

            const response = await fetch(apiUrl, {
                headers: {
                    ...this.headers,
                    'Referer': referer,
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            if (!response.ok) return null;
            const data = await response.json();

            // La risposta contiene tipicamente un campo "grabber" o "url"
            if (data?.grabber) return data.grabber;
            if (data?.url) return data.url;
            if (data?.server?.url) return data.server.url;

            // Cerca in tutti i campi
            const str = JSON.stringify(data);
            const m3u8Match = str.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
            if (m3u8Match) return m3u8Match[1];
            const mp4Match = str.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
            if (mp4Match) return mp4Match[1];

        } catch (e) {
            console.log("[AnimeWorld] Errore API:", e.message);
        }
        return null;
    }

    extractVideoUrl(html) {
        const decoded = this.decodeEntities(html);
        const BLOCKED = ['youtube.com','youtu.be','dailymotion.com','a-ads.com','adsterra','propellerads','popads'];
        const isBlocked = (u) => BLOCKED.some(h => u.includes(h));

        const patterns = [
            /(?:src|file|url|source)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4))["']/i,
            /"(https:\/\/[^"]+\.m3u8[^"]*)"/i
        ];
        for (const p of patterns) {
            const m = decoded.match(p);
            if (m && m[1] && !isBlocked(m[1])) return m[1];
        }
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
        for (const m of [...decoded.matchAll(iframeRegex)]) {
            if (m[1] && !isBlocked(m[1])) return m[1];
        }
        return null;
    }

    decodeEntities(str) {
        return (str || '')
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&').replace(/&#x3D;/g, '=')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
}
export default new TorrentSource();
