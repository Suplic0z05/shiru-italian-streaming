import AbstractSource from './abstract.js'

/**
 * Estensione AnimeWorld per Shiru
 * Sito: https://www.animeworld.ac/
 *
 * Implementa lo scraping delle pagine di ricerca e degli episodi per estrarre
 * i link di streaming diretto. I campi torrent sono compilati con valori fittizi
 * (seeders/leechers/downloads/hash/size) per soddisfare l'interfaccia di Shiru,
 * poiché la fonte restituisce stream HTTP (m3u8/mp4) e non veri torrent.
 *
 * @extends AbstractSource
 */
export default new class AnimeWorldSource extends AbstractSource {
    url = 'https://www.animeworld.ac'

    settings = {}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": this.url
    }

    /**
     * Ricerca un singolo episodio
     * @type {import('./').SearchFunction}
     */
    async single(query) {
        try {
            const titles = query?.titles ?? []
            const title = titles[0] || titles[titles.length - 1] || '?'
            const episode = query?.episode || 1

            const searchUrl = `${this.url}/search?keyword=${encodeURIComponent(title)}`
            const searchResponse = await fetch(searchUrl, { headers: this.headers })

            if (!searchResponse.ok) {
                console.error(`Errore ricerca: ${searchResponse.status}`)
                return []
            }

            const searchHtml = await searchResponse.text()
            const animeLink = this.extractAnimeLink(searchHtml, title)

            if (!animeLink) {
                console.log("Nessun risultato trovato per:", title)
                return []
            }

            const episodeUrl = this.buildEpisodeUrl(animeLink, episode)
            const episodeResponse = await fetch(episodeUrl, { headers: this.headers })

            if (!episodeResponse.ok) {
                console.error(`Errore episodio: ${episodeResponse.status}`)
                return []
            }

            const episodeHtml = await episodeResponse.text()
            const videoUrl = this.extractVideoUrl(episodeHtml)

            if (!videoUrl) {
                console.log("Impossibile estrarre URL video per episodio", episode)
                return []
            }

            return [{
                title: `${title} - Episodio ${episode} [AnimeWorld]`,
                link: videoUrl,
                seeders: 0,
                leechers: 0,
                downloads: 0,
                accuracy: 'high',
                hash: `animeworld-${episode}-${Date.now()}`,
                size: 0,
                date: new Date(),
                type: 'best'
            }]

        } catch (error) {
            console.error("Errore in single():", error.message)
            return []
        }
    }

    /**
     * Ricerca batch (tutti gli episodi di una stagione)
     * @type {import('./').SearchFunction}
     */
    async batch(query) {
        try {
            const title = query?.titles?.[0] || '?'
            const episodeCount = query?.episodeCount || 12
            const results = []

            const searchUrl = `${this.url}/search?keyword=${encodeURIComponent(title)}`
            const searchResponse = await fetch(searchUrl, { headers: this.headers })

            if (!searchResponse.ok) return []

            const searchHtml = await searchResponse.text()
            const animeLink = this.extractAnimeLink(searchHtml, title)

            if (!animeLink) return []

            for (let ep = 1; ep <= episodeCount; ep++) {
                try {
                    const episodeUrl = this.buildEpisodeUrl(animeLink, ep)
                    const response = await fetch(episodeUrl, { headers: this.headers })

                    if (response.ok) {
                        const html = await response.text()
                        const videoUrl = this.extractVideoUrl(html)

                        if (videoUrl) {
                            results.push({
                                title: `${title} - Episodio ${ep} [AnimeWorld]`,
                                link: videoUrl,
                                seeders: 0,
                                leechers: 0,
                                downloads: 0,
                                accuracy: 'high',
                                hash: `animeworld-batch-${ep}-${Date.now()}`,
                                size: 0,
                                date: new Date(),
                                type: 'batch'
                            })
                        }
                    }
                } catch (e) {
                    console.log(`Episodio ${ep} non disponibile`)
                }
            }

            return results

        } catch (error) {
            console.error("Errore in batch():", error.message)
            return []
        }
    }

    /**
     * Ricerca film
     * @type {import('./').SearchFunction}
     */
    async movie(query) {
        return this.single({ ...query, episode: 1 })
    }

    /**
     * Validazione della fonte
     * @type {() => Promise<boolean>}
     */
    async validate() {
        try {
            const response = await fetch(this.url, {
                method: 'HEAD',
                headers: this.headers
            })
            return response.ok
        } catch (error) {
            console.error("Validazione fallita:", error.message)
            return false
        }
    }

    /**
     * Estrae il link dell'anime dai risultati di ricerca, preferendo un
     * risultato il cui titolo corrisponde a quello cercato.
     * @param {string} html - HTML della pagina di ricerca
     * @param {string} title - Titolo cercato
     * @returns {string|null} Link dell'anime
     */
    extractAnimeLink(html, title) {
        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

        // Pattern: <a href="/play/<slug>.<id>" ...><img ... alt="Title">
        const regex = /href="\/play\/([^"]+)"[^>]*>\s*<img[^>]*alt="([^"]+)"/gi;
        const matches = [...html.matchAll(regex)];

        if (matches.length > 0) {
            const t = norm(title.split(/[:\-_\[\]()]/)[0]).trim().slice(0, 20)
            let best = matches[0][1]
            let bestScore = -1

            for (const m of matches) {
                const alt = norm(m[2])
                let score = 0
                if (t && alt.includes(t)) score += 3
                // Evita risultati parziali/trailer (suffissi tipo -2023, movie)
                if (t && !/(movie|movie-|film|-202\d|\[)/.test(m[2])) score += 1

                if (score > bestScore) {
                    bestScore = score
                    best = m[1]
                }
            }
            return `${this.url}/play/${best}`;
        }

        // Fallback: cerca nel DOM con pattern alternativi
        const altRegex = /data-id="([^"]+)"/gi;
        const altMatches = [...html.matchAll(altRegex)];

        if (altMatches.length > 0) {
            return `${this.url}/play/${altMatches[0][1]}`;
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
     * Estrae l'URL video dalla pagina episodio.
     * Evita i player/trailer YouTube che il sito mostra come player predefinito.
     * @param {string} html - HTML della pagina episodio
     * @returns {string|null} URL video diretto
     */
    extractVideoUrl(html) {
        const decoded = this.decodeEntities(html)
        const BLOCKED_HOSTS = ['youtube.com', 'youtu.be', 'dailymotion.com', 'a-ads.com', 'ad.a-ads.com', 'acceptable.a-ads.com', 'usesponsorarrange.com', 'adsterra', 'propellerads', 'popads']

        const isBlocked = (url) => BLOCKED_HOSTS.some(h => url.includes(h))

        // Cerca URL video in vari formati (m3u8, mp4, embed)
        const patterns = [
            /(?:src|file|url|source)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4))["']/i,
            /streamtape\.com\/[a-zA-Z0-9]+/i,
            /filemoon\.in\/[a-zA-Z0-9]+/i,
            /"(https:\/\/[^"]+\.m3u8[^"]*)"/i
        ];

        for (const pattern of patterns) {
            const match = decoded.match(pattern);
            if (match && match[1] && !isBlocked(match[1])) {
                return match[1];
            }
        }

        // Cerca iframe con player embed, scartando trailer (YouTube ecc.) e ad
        const iframeRegex = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/g;
        const iframes = [...decoded.matchAll(iframeRegex)];

        for (const m of iframes) {
            const url = m[1];
            if (url && !isBlocked(url)) {
                return url;
            }
        }

        return null;
    }

    /**
     * Decodifica le entità HTML (&quot;, &amp;, &#x3D;) in caratteri reali.
     * @param {string} str
     * @returns {string}
     */
    decodeEntities(str) {
        return (str || '')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&#x3D;/g, '=')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
    }
}()
