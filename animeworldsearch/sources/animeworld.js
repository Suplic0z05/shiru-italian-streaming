/**
 * Estensione AnimeWorld per Shiru
 * Sito: https://www.animeworld.ac/
 * 
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming diretto. I campi torrent sono compilati con valori fittizi
 * per soddisfare i requisiti dell'interfaccia TorrentSource di Shiru.
 */

export class TorrentSource {
    constructor() {
        this.baseUrl = "https://www.animeworld.ac";
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": this.baseUrl
        };
    }

    /**
     * Ricerca un singolo episodio
     * @param {Object} query - Oggetto query di Shiru
     * @returns {Promise<Array>} Array di risultati
     */
    async single(query) {
        try {
            const title = query.titles[0] || query.titles[query.titles.length - 1];
            const episode = query.episode || 1;
            
            // Ricerca anime
            const searchUrl = `${this.baseUrl}/search?keyword=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) {
                console.error(`Errore ricerca: ${searchResponse.status}`);
                return [];
            }
            
            const searchHtml = await searchResponse.text();
            const animeLink = this.extractAnimeLink(searchHtml, title);
            
            if (!animeLink) {
                console.log("Nessun risultato trovato per:", title);
                return [];
            }
            
            // Recupera pagina episodio
            const episodeUrl = this.buildEpisodeUrl(animeLink, episode);
            const episodeResponse = await fetch(episodeUrl, { headers: this.headers });
            
            if (!episodeResponse.ok) {
                console.error(`Errore episodio: ${episodeResponse.status}`);
                return [];
            }
            
            const episodeHtml = await episodeResponse.text();
            const videoUrl = this.extractVideoUrl(episodeHtml);
            
            if (!videoUrl) {
                console.log("Impossibile estrarre URL video per episodio", episode);
                return [];
            }
            
            return [{
                title: `${title} - Episodio ${episode} [AnimeWorld]`,
                link: videoUrl,
                seeders: 0,
                leechers: 0,
                downloads: 0,
                accuracy: "high",
                hash: `animeworld-${Date.now()}`,
                size: 0,
                date: new Date(),
                type: "best"
            }];
            
        } catch (error) {
            console.error("Errore in single():", error.message);
            return [];
        }
    }

    /**
     * Ricerca batch (tutti gli episodi di una stagione)
     * @param {Object} query 
     * @returns {Promise<Array>}
     */
    async batch(query) {
        try {
            const title = query.titles[0];
            const episodeCount = query.episodeCount || 12;
            const results = [];
            
            // Ricerca anime
            const searchUrl = `${this.baseUrl}/search?keyword=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeLink = this.extractAnimeLink(searchHtml, title);
            
            if (!animeLink) return [];
            
            // Recupera tutti gli episodi disponibili
            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const episodeUrl = this.buildEpisodeUrl(animeLink, ep);
                    const response = await fetch(episodeUrl, { headers: this.headers });
                    
                    if (response.ok) {
                        const html = await response.text();
                        const videoUrl = this.extractVideoUrl(html);
                        
                        if (videoUrl) {
                            results.push({
                                title: `${title} - Episodio ${ep} [AnimeWorld]`,
                                link: videoUrl,
                                seeders: 0,
                                leechers: 0,
                                downloads: 0,
                                accuracy: "high",
                                hash: `animeworld-batch-${ep}-${Date.now()}`,
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

    /**
     * Ricerca film
     * @param {Object} query 
     * @returns {Promise<Array>}
     */
    async movie(query) {
        return this.single({ ...query, episode: 1 });
    }

    /**
     * Validazione della fonte
     * @returns {Promise<boolean>}
     */
    async validate() {
        try {
            const response = await fetch(this.baseUrl, { 
                method: "HEAD",
                headers: this.headers 
            });
            return response.ok;
        } catch (error) {
            console.error("Validazione fallita:", error.message);
            return false;
        }
    }

    /**
     * Estrae il link dell'anime dai risultati di ricerca
     * @param {string} html - HTML della pagina di ricerca
     * @param {string} title - Titolo cercato
     * @returns {string|null} Link dell'anime
     */
    extractAnimeLink(html, title) {
        // Pattern per link anime: /play/<slug>.<id>
        const regex = /href="\/play\/([^"]+)"[^>]*>[^<]*<\/a>/gi;
        const matches = [...html.matchAll(regex)];
        
        if (matches.length > 0) {
            // Ritorna il primo risultato (più pertinente)
            return `${this.baseUrl}/play/${matches[0][1]}`;
        }
        
        // Fallback: cerca nel DOM con pattern alternativi
        const altRegex = /data-id="([^"]+)"/gi;
        const altMatches = [...html.matchAll(altRegex)];
        
        if (altMatches.length > 0) {
            return `${this.baseUrl}/play/${altMatches[0][1]}`;
        }
        
        return null;
    }

    /**
     * Costruisce l'URL dell'episodio
     * @param {string} animeLink - Link della pagina anime
     * @param {number} episode - Numero episodio
     * @returns {string} URL episodio
     */
    buildEpisodeUrl(animeLink, episode) {
        // Formato tipico: /play/<slug>.<id>/<episode>
        return `${animeLink}/${episode}`;
    }

    /**
     * Estrae l'URL video dalla pagina episodio
     * @param {string} html - HTML della pagina episodio
     * @returns {string|null} URL video diretto
     */
    extractVideoUrl(html) {
        // Cerca URL video in vari formati (m3u8, mp4, embed)
        const patterns = [
            /(?:src|file|url|source)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4))["']/i,
            /embed\/[^"'\s]+/i,
            /streamtape\.com\/[a-zA-Z0-9]+/i,
            /filemoon\.in\/[a-zA-Z0-9]+/i,
            /"(https:\/\/[^"]+\.m3u8[^"]*)"/i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        
        // Cerca iframe con player embed
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/i;
        const iframeMatch = html.match(iframeRegex);
        
        if (iframeMatch && iframeMatch[1]) {
            return iframeMatch[1];
        }
        
        return null;
    }
}

export default new TorrentSource();
