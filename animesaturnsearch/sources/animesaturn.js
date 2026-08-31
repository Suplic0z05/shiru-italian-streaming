/**
 * Estensione AnimeSaturn per Shiru
 * Sito: https://www.animesaturn.net/
 * 
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming diretto da player embed (Streamtape, FileMoon, ecc.).
 */

export class TorrentSource {
    constructor() {
        this.url = 'https://www.animesaturn.net';
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9",
            "Referer": this.url
        };
    }

    /**
     * Query results for a single episode.
     * @type {import('./index.d.ts').SearchFunction}
     */
    async single(query) {
        try {
            const titles = query?.titles ?? [];
            const title = titles[0] || '?';
            const episode = query?.episode || 1;

            const searchUrl = `${this.url}/filter?key=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeSlug = this.extractAnimeSlug(searchHtml);
            
            if (!animeSlug) {
                console.log("Nessun risultato trovato per:", title);
                return [];
            }

            const episodeUrl = `${this.url}/episode/${animeSlug}/ep-${episode}`;
            const episodeResponse = await fetch(episodeUrl, { headers: this.headers });
            
            if (!episodeResponse.ok) {
                console.log(`Episodio ${episode} non trovato`);
                return [];
            }

            const episodeHtml = await episodeResponse.text();
            const videoUrl = await this.extractVideoUrl(episodeHtml);
            
            if (!videoUrl) {
                console.log("Impossibile estrarre URL video");
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
            console.error("Errore in single():", error.message);
            return [];
        }
    }

    /**
     * Query results for a batch of episodes.
     * @type {import('./index.d.ts').SearchFunction}
     */
    async batch(query) {
        try {
            const title = query?.titles?.[0] || '?';
            const episodeCount = query?.episodeCount || 12;
            const results = [];

            const searchUrl = `${this.url}/filter?key=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeSlug = this.extractAnimeSlug(searchHtml);
            
            if (!animeSlug) return [];

            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const episodeUrl = `${this.url}/episode/${animeSlug}/ep-${ep}`;
                    const response = await fetch(episodeUrl, { headers: this.headers });
                    
                    if (response.ok) {
                        const html = await response.text();
                        const videoUrl = await this.extractVideoUrl(html);
                        
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
                    }
                } catch (e) {
                    console.log(`Episodio ${ep} non disponibile`);
                }
            }

            return results;
        } catch (error) {
            console.error("Errore in batch():", error.message);
            return [];
        }
    }

    /**
     * Query results for a movie.
     * @type {import('./index.d.ts').SearchFunction}
     */
    async movie(query) {
        return this.single({ ...query, episode: 1 });
    }

    /**
     * Validates the source url.
     * @type {() => Promise<boolean>}
     */
    async validate() {
        try {
            const response = await fetch(this.url, {
                method: 'HEAD',
                headers: this.headers
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Estrae lo slug dell'anime dalla ricerca.
     * @param {string} html - HTML pagina ricerca
     * @returns {string|null} Slug anime
     */
    extractAnimeSlug(html) {
        const decoded = this.decodeEntities(html);
        
        // Pattern per link anime: /anime/<slug>
        const regex = /href="\/anime\/([^"]+)"[^>]*>/gi;
        const matches = [...decoded.matchAll(regex)];
        
        if (matches.length > 0) {
            return matches[0][1];
        }
        
        // Fallback: cerca data-slug
        const altRegex = /data-slug=["']([^"']+)["']/gi;
        const altMatches = [...decoded.matchAll(altRegex)];
        
        if (altMatches.length > 0) {
            return altMatches[0][1];
        }
        
        return null;
    }

    /**
     * Estrae l'URL video dalla pagina episodio.
     * @param {string} html - HTML pagina episodio
     * @returns {Promise<string|null>} URL video
     */
    async extractVideoUrl(html) {
        const decoded = this.decodeEntities(html);
        
        const BLOCKED_HOSTS = [
            'youtube.com', 'youtu.be', 'dailymotion.com',
            'a-ads.com', 'ad.a-ads.com', 'acceptable.a-ads.com',
            'usesponsorarrange.com', 'adsterra', 'propellerads', 'popads'
        ];
        
        const isBlocked = (url) => BLOCKED_HOSTS.some(h => url.includes(h));

        // Cerca iframe con player embed
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
        const iframes = [...decoded.matchAll(iframeRegex)];
        
        for (const m of iframes) {
            const embedUrl = m[1];
            
            if (isBlocked(embedUrl)) continue;
            
            if (embedUrl.includes('streamtape') || embedUrl.includes('filemoon')) {
                try {
                    const embedResponse = await fetch(embedUrl, { headers: this.headers });
                    const embedHtml = await embedResponse.text();
                    const embedDecoded = this.decodeEntities(embedHtml);
                    
                    const videoPatterns = [
                        /['"](https?:\/\/[^"']+\.mp4[^"']*)['"]/i,
                        /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i,
                        /file:\s*['"](https?:\/\/[^"']+)['"]/i
                    ];
                    
                    for (const pattern of videoPatterns) {
                        const match = embedDecoded.match(pattern);
                        if (match && match[1] && !isBlocked(match[1])) {
                            return match[1];
                        }
                    }
                } catch (e) {
                    console.error("Errore fetching embed:", e.message);
                }
            }
            
            // Se non è un embed noto, ritorna l'URL stesso
            return embedUrl;
        }

        // Cerca URL video diretti nell'HTML
        const directPatterns = [
            /['"](https?:\/\/[^"']+\.mp4[^"']*)['"]/i,
            /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i,
            /source:\s*['"](https?:\/\/[^"']+)['"]/i,
            /file:\s*['"](https?:\/\/[^"']+)['"]/i
        ];
        
        for (const pattern of directPatterns) {
            const match = decoded.match(pattern);
            if (match && match[1] && !isBlocked(match[1])) {
                return match[1];
            }
        }
        
        return null;
    }

    /**
     * Decodifica le entità HTML.
     * @param {string} str
     * @returns {string}
     */
    decodeEntities(str) {
        return (str || '')
            .replace(/&quot;/g, '"')
            .replace(/&#039;|'/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&#x3D;|=/g, '=')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    }
}

export default new TorrentSource();