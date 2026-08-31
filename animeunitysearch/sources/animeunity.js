/**
 * Estensione AnimeUnity per Shiru
 * Sito: https://www.animeunity.so/
 * 
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming HLS (m3u8) diretti. I campi torrent sono compilati con
 * valori fittizi per soddisfare l'interfaccia di Shiru.
 */

export class TorrentSource {
    url = 'https://www.animeunity.so';
    settings = {};
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": this.url
    };

    async single(query) {
        try {
            const titles = query?.titles ?? [];
            const title = titles[0] || '?';
            const episode = query?.episode || 1;

            const searchUrl = `${this.url}/archivio?title=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeInfo = this.extractAnimeInfo(searchHtml);
            
            if (!animeInfo) {
                console.log("Nessun risultato trovato per:", title);
                return [];
            }

            const animeUrl = `${this.url}/anime/${animeInfo.id}-${animeInfo.slug}`;
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
                accuracy: 'high',
                hash: `animeunity-${episode}-${Date.now()}`,
                size: 0,
                date: new Date(),
                type: 'best'
            }];
        } catch (error) {
            console.error("Errore in single():", error.message);
            return [];
        }
    }

    async batch(query) {
        try {
            const title = query?.titles?.[0] || '?';
            const episodeCount = query?.episodeCount || 12;
            const results = [];

            const searchUrl = `${this.url}/archivio?title=${encodeURIComponent(title)}`;
            const searchResponse = await fetch(searchUrl, { headers: this.headers });
            
            if (!searchResponse.ok) return [];
            
            const searchHtml = await searchResponse.text();
            const animeInfo = this.extractAnimeInfo(searchHtml);
            
            if (!animeInfo) return [];

            const animeUrl = `${this.url}/anime/${animeInfo.id}-${animeInfo.slug}`;
            const animeResponse = await fetch(animeUrl, { headers: this.headers });
            
            if (!animeResponse.ok) return [];
            
            const animeHtml = await animeResponse.text();

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
                            accuracy: 'high',
                            hash: `animeunity-batch-${ep}-${Date.now()}`,
                            size: 0,
                            date: new Date(),
                            type: 'batch'
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
            const response = await fetch(this.url, {
                method: 'HEAD',
                headers: this.headers
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    extractAnimeInfo(html) {
        const decoded = this.decodeEntities(html);
        
        // Pattern: /anime/<id>-<slug>
        const regex = /href="\/anime\/(\d+)-([^"]+)"/gi;
        const matches = [...decoded.matchAll(regex)];
        
        if (matches.length > 0) {
            return {
                id: matches[0][1],
                slug: matches[0][2]
            };
        }
        
        // Fallback: cerca nel JSON embedded
        const jsonRegex = /data-anime=["']?{[^}]*id["']?\s*:\s*["']?(\d+)["']?[^}]*slug["']?\s*:\s*["']?([^"']+)["']?/i;
        const jsonMatch = decoded.match(jsonRegex);
        
        if (jsonMatch) {
            return {
                id: jsonMatch[1],
                slug: jsonMatch[2]
            };
        }
        
        return null;
    }

    async extractVideoUrl(html, episode) {
        const decoded = this.decodeEntities(html);
        
        const BLOCKED_HOSTS = [
            'youtube.com', 'youtu.be', 'dailymotion.com',
            'a-ads.com', 'ad.a-ads.com', 'acceptable.a-ads.com',
            'usesponsorarrange.com', 'adsterra', 'propellerads', 'popads'
        ];
        
        const isBlocked = (url) => BLOCKED_HOSTS.some(h => url.includes(h));

        // Cerca pattern episodio specifico
        const episodeRegex = new RegExp(
            `(?:episode|ep)\\s*[:=]\\s*["']?${episode}["']?[^}]*` +
            `(?:url|src|file|link)\\s*[:=]\\s*["']([^"']+)["']`,
            'gi'
        );
        
        const match = decoded.match(episodeRegex);
        if (match && match[1] && !isBlocked(match[1])) {
            return match[1];
        }

        // Cerca URL m3u8
        const m3u8Regex = /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/gi;
        const m3u8Matches = [...decoded.matchAll(m3u8Regex)];
        
        if (m3u8Matches.length > 0) {
            for (const m of m3u8Matches) {
                if (!isBlocked(m[1]) && (m[1].includes(`ep${episode}`) || m[1].includes(`episode${episode}`))) {
                    return m[1];
                }
            }
            const first = m3u8Matches.find(m => !isBlocked(m[1]));
            if (first) return first[1];
        }

        // Cerca iframe con player
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
        const iframes = [...decoded.matchAll(iframeRegex)];
        
        for (const m of iframes) {
            const embedUrl = m[1];
            if (isBlocked(embedUrl)) continue;
            
            try {
                const embedResponse = await fetch(embedUrl, { headers: this.headers });
                const embedHtml = await embedResponse.text();
                const embedDecoded = this.decodeEntities(embedHtml);
                
                const embedM3u8Regex = /['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i;
                const embedMatch = embedDecoded.match(embedM3u8Regex);
                
                if (embedMatch && embedMatch[1] && !isBlocked(embedMatch[1])) {
                    return embedMatch[1];
                }
                
                return embedUrl;
            } catch (e) {
                console.error("Errore fetching embed:", e.message);
            }
        }
        
        return null;
    }

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