/**
 * Estensione AnimeSaturn per Shiru
 * Sito: https://www.animesaturn.net/
 * 
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming diretto da player embed (Streamtape, FileMoon, ecc.).
 */

export class TorrentSource {
    constructor() {
        this.baseUrl = "https://www.animesaturn.net";
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9",
            "Referer": this.baseUrl
        };
    }

    async single(query) {
        try {
            const title = query.titles[0];
            const episode = query.episode || 1;
            
            // Ricerca: /animelist?search=<query>
            const searchUrl = `${this.baseUrl}/animelist?search=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeSlug = this.extractAnimeSlug(searchHtml, title);
            
            if (!animeSlug) {
                console.log("Nessun risultato trovato per:", title);
                return [];
            }
            
            // Pagina episodio: /ep/<slug>-ep-<number>
            const episodeUrl = `${this.baseUrl}/ep/${animeSlug}-ep-${episode}`;
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
                accuracy: "high",
                hash: `animesaturn-${Date.now()}`,
                size: 0,
                date: new Date(),
                type: "best"
            }];
            
        } catch (error) {
            console.error("Errore in single():", error.message);
            return [];
        }
    }

    async batch(query) {
        try {
            const title = query.titles[0];
            const episodeCount = query.episodeCount || 12;
            const results = [];
            
            const searchUrl = `${this.baseUrl}/animelist?search=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeSlug = this.extractAnimeSlug(searchHtml, title);
            
            if (!animeSlug) return [];
            
            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const episodeUrl = `${this.baseUrl}/ep/${animeSlug}-ep-${ep}`;
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
                                accuracy: "high",
                                hash: `animesaturn-batch-${ep}-${Date.now()}`,
                                size: 0,
                                date: new Date(),
                                type: "batch"
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

    async movie(query) {
        return this.single({ ...query, episode: 1 });
    }

    async validate() {
        try {
            const response = await fetch(this.baseUrl, { 
                method: "HEAD",
                headers: this.headers 
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Estrae lo slug dell'anime dalla ricerca
     * @param {string} html - HTML pagina ricerca
     * @param {string} title - Titolo cercato
     * @returns {string|null} Slug anime
     */
    extractAnimeSlug(html, title) {
        // Pattern per link anime: /animelist/<slug>
        const regex = /href="\/animelist\/([^"]+)"[^>]*>[^<]*<\/a>/gi;
        const matches = [...html.matchAll(regex)];
        
        if (matches.length > 0) {
            return matches[0][1];
        }
        
        // Fallback: cerca link con data attributes
        const altRegex = /data-slug=["']([^"']+)["']/gi;
        const altMatches = [...html.matchAll(altRegex)];
        
        if (altMatches.length > 0) {
            return altMatches[0][1];
        }
        
        return null;
    }

    /**
     * Estrae l'URL video dalla pagina episodio
     * Gestisce vari player embed (Streamtape, FileMoon, ecc.)
     * @param {string} html - HTML pagina episodio
     * @returns {Promise<string|null>} URL video
     */
    async extractVideoUrl(html) {
        // Cerca iframe con player
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/i;
        const iframeMatch = html.match(iframeRegex);
        
        if (iframeMatch && iframeMatch[1]) {
            const embedUrl = iframeMatch[1];
            
            // Se è un URL embed diretto, prova a estrarre il video
            if (embedUrl.includes('streamtape') || embedUrl.includes('filemoon')) {
                try {
                    const embedResponse = await fetch(embedUrl, { headers: this.headers });
                    const embedHtml = await embedResponse.text();
                    
                    // Cerca URL video nell'embed
                    const videoPatterns = [
                        /['"](https?:\/\/[^"']+\.mp4[^"']*)['"]/i,
                        /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i,
                        /file:\s*['"](https?:\/\/[^"']+)['"]/i
                    ];
                    
                    for (const pattern of videoPatterns) {
                        const match = embedHtml.match(pattern);
                        if (match && match[1]) {
                            return match[1];
                        }
                    }
                } catch (e) {
                    console.error("Errore fetching embed:", e.message);
                }
            }
            
            // Ritorna l'URL embed se non riesci a estrarre il video diretto
            return embedUrl;
        }
        
        // Cerca URL video direttamente nell'HTML
        const directPatterns = [
            /['"](https?:\/\/[^"']+\.mp4[^"']*)['"]/i,
            /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i,
            /source:\s*['"](https?:\/\/[^"']+)['"]/i,
            /file:\s*['"](https?:\/\/[^"']+)['"]/i
        ];
        
        for (const pattern of directPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        return null;
    }
}

export default new TorrentSource();
