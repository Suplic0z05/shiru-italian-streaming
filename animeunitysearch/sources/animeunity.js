// AnimeUnity Source for Shiru
// Provides streaming links from animeunity.so

export default new class AnimeUnity {
  url = 'https://www.animeunity.so'
  
  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": "https://www.animeunity.so/",
    "X-Requested-With": "XMLHttpRequest"
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
      
      // Search for anime via API
      const apiRes = await fetch(`${this.url}/api/it/anime`, {
        method: 'POST',
        headers: { 
          ...this.headers, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ title: title })
      })
      
      let animeInfo = null
      
      if (apiRes.ok) {
        const data = await apiRes.json()
        const records = data?.records || data?.data || (Array.isArray(data) ? data : [])
        
        if (records.length > 0) {
          animeInfo = { 
            id: records[0].id, 
            slug: records[0].slug 
          }
        }
      }
      
      if (!animeInfo) return []
      
      // Get episode page
      const epUrl = `${this.url}/it/anime/${animeInfo.id}-${animeInfo.slug}/${episode}`
      const epRes = await fetch(epUrl, { headers: this.headers })
      
      if (!epRes.ok) return []
      
      const html = await epRes.text()
      
      // Extract video URL (m3u8 or iframe)
      const videoMatch = html.match(/['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/i) 
        || html.match(/<iframe[^>]*src=["']([^"']+)["']/i)
      
      if (videoMatch) {
        return [{
          title: `${title} - Ep ${episode} [AU]`,
          link: videoMatch[1],
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: 'high',
          hash: `au-${episode}`,
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
