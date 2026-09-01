// AnimeSaturn Source for Shiru
// Provides streaming links from animesaturn.net

export default new class AnimeSaturn {
  url = 'https://www.animesaturn.net'
  
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": "https://www.animesaturn.net/"
  }

  /**
   * Search for a single episode
   * @param {Object} query
   * @param {string[]} query.titles
   * @param {number} query.episode
   * @returns {Promise<Array>}
   */
  async single(query) {
    try {
      const title = query?.titles?.[0] || '?'
      const episode = query?.episode || 1
      
      // Search for the anime
      const res = await fetch(`${this.url}/animelist?search=${encodeURIComponent(title)}`, { 
        headers: this.headers 
      })
      
      if (!res.ok) return []
      
      const html = await res.text()
      
      // Extract anime slug
      const slugMatch = html.match(/href="\/anime\/([^"]+)"/i)
      if (!slugMatch) return []
      
      const slug = slugMatch[1]
      
      // Get anime page
      const animeRes = await fetch(`${this.url}/anime/${slug}`, { 
        headers: this.headers 
      })
      
      if (!animeRes.ok) return []
      
      const animeHtml = await animeRes.text()
      
      // Find episode link
      const epMatch = animeHtml.match(new RegExp(`href="(/ep/[^"]+-ep-${episode})"`, 'i'))
      if (!epMatch) return []
      
      const epUrl = `${this.url}${epMatch[1]}`
      
      // Get episode page
      const epRes = await fetch(epUrl, { headers: this.headers })
      if (!epRes.ok) return []
      
      const epHtml = await epRes.text()
      
      // Extract video URL (m3u8 or iframe)
      const videoMatch = epHtml.match(/['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i) 
        || epHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i)
      
      if (videoMatch) {
        return [{
          title: `${title} - Ep ${episode} [AS]`,
          link: videoMatch[1],
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: 'high',
          hash: `as-${episode}`,
          size: 0,
          date: new Date(),
          type: 'best'
        }]
      }
      
      return []
    } catch (e) { 
      return [] 
    }
  }

  /**
   * Search for batch of episodes
   * @param {Object} query
   * @returns {Promise<Array>}
   */
  async batch(query) { 
    return [] 
  }

  /**
   * Search for movie
   * @param {Object} query
   * @returns {Promise<Array>}
   */
  async movie(query) { 
    return this.single({ ...query, episode: 1 }) 
  }

  /**
   * Validate source availability
   * @returns {Promise<boolean>}
   */
  async validate() { 
    try { 
      const r = await fetch(this.url, { 
        method: 'HEAD', 
        headers: this.headers 
      }) 
      return r.ok 
    } catch { 
      return false 
    } 
  }
}()
