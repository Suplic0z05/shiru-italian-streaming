/**
 * Estensione AnimeUnity per Shiru
 * Sito: https://www.animeunity.so/
 * 
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming HLS (m3u8) diretti.
 */

export class TorrentSource {
    constructor() {
        this.baseUrl = "https://www.animeunity.so";
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
            
            // Ricerca: /archivio?title=<query>
            const searchUrl = `${this.baseUrl}/archivio?title=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeInfo = this.extractAnimeInfo(searchHtml, title);
            
            if (!animeInfo) {
                console.log("Nessun risultato trovato per:", title);
                return [];
            }
            
            // Pagina anime: /anime/<id>-<slug>
            const animeUrl = `${this.baseUrl}/anime/${animeInfo.id}-${animeInfo.slug}`;
            const animeResponse = await fetch(animeUrl, { headers: this.headers });
            
            if (!animeResponse.ok) return [];
            
            const animeHtml = await animeResponse.text();
            const videoUrl = await this.extractVideoUrl(animeHtml, episode);
            
            if (!videoUrl) {
                console.log(`Impossibile estrarre URL video per episodio ${episode}`);
                return [];
            }
            
            return [{
                title: `${title} - Episodio ${episode} [AnimeUnity]`,
                link: videoUrl,
                seeders: 0,
                leechers: 0,
                downloads: 0,
                accuracy: "high",
                hash: `animeunity-${Date.now()}`,
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
            
            const searchUrl = `${this.baseUrl}/archivio?title=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeInfo = this.extractAnimeInfo(searchHtml, title);
            
            if (!animeInfo) return [];
            
            const animeUrl = `${this.baseUrl}/anime/${animeInfo.id}-${animeInfo.slug}`;
            const animeResponse = await fetch(animeUrl, { headers: this.headers });
            
            if (!animeResponse.ok) return [];
            
            const animeHtml = await animeResponse.text();
            
            // Estrai tutti gli episodi disponibili
            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const videoUrl = await this.extractVideoUrl(animeHtml, ep);
                    
                    if (videoUrl) {
                        results.push({
                            title: `${title} - Episodio ${ep} [AnimeUnity]`,
                            link: videoUrl,
                            seeders: 0,
                            leechers: 0,
                            downloads: 0,
                            accuracy: "high",
                            hash: `animeunity-batch-${ep}-${Date.now()}`,
                            size: 0,
                            date: new Date(),
                            type: "batch"
                        });
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
     * Estrae ID e slug dell'anime dalla ricerca
     * @param {string} html - HTML pagina ricerca
     * @param {string} title - Titolo cercato
     * @returns {Object|null} {id, slug}
     */
    extractAnimeInfo(html, title) {
        // Pattern per link anime: /anime/<id>-<slug>
        const regex = /href="\/anime\/(\d+)-([^"]+)"[^>]*>/gi;
        const matches = [...html.matchAll(regex)];
        
        if (matches.length > 0) {
            return {
                id: matches[0][1],
                slug: matches[0][2]
            };
        }
        
        // Fallback: cerca nel JSON embedded
        const jsonRegex = /data-anime=["']?{[^}]*id["']?\s*:\s*["']?(\d+)["']?[^}]*slug["']?\s*:\s*["']?([^"']+)["']?/i;
        const jsonMatch = html.match(jsonRegex);
        
        if (jsonMatch) {
            return {
                id: jsonMatch[1],
                slug: jsonMatch[2]
            };
        }
        
        return null;
    }

    /**
     * Estrae l'URL video per un episodio specifico
     * @param {string} html - HTML pagina anime
     * @param {number} episode - Numero episodio
     * @returns {Promise<string|null>} URL video HLS/diretto
     */
    async extractVideoUrl(html, episode) {
        // Cerca pattern episodio nel JavaScript embedded
        const episodeRegex = new RegExp(
            `(?:episode|ep)\\s*[:=]\\s*["']?${episode}["']?[^}]*` +
            `(?:url|src|file|link)\\s*[:=]\\s*["']([^"']+)["']`,
            'gi'
        );
        
        const match = html.match(episodeRegex);
        if (match && match[1]) {
            return match[1];
        }
        
        // Cerca URL m3u8 generici
        const m3u8Regex = /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/gi;
        const m3u8Matches = [...html.matchAll(m3u8Regex)];
        
        if (m3u8Matches.length > 0) {
            // Se c'è un pattern con il numero dell'episodio, preferiscilo
            for (const m of m3u8Matches) {
                if (m[1].includes(`ep${episode}`) || m[1].includes(`episode${episode}`)) {
                    return m[1];
                }
            }
            // Altrimenti ritorna il primo URL m3u8 trovato
            return m3u8Matches[0][1];
        }
        
        // Cerca iframe con player
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/i;
        const iframeMatch = html.match(iframeRegex);
        
        if (iframeMatch && iframeMatch[1]) {
            try {
                const embedUrl = iframeMatch[1];
                const embedResponse = await fetch(embedUrl, { headers: this.headers });
                const embedHtml = await embedResponse.text();
                
                // Cerca m3u8 nell'embed
                const embedM3u8Regex = /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i;
                const embedMatch = embedHtml.match(embedM3u8Regex);
                
                if (embedMatch && embedMatch[1]) {
                    return embedMatch[1];
                }
                
                return embedUrl;
            } catch (e) {
                console.error("Errore fetching embed:", e.message);
            }
        }
        
        return null;
    }
}

export default new TorrentSource();
