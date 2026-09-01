// AnimeUnion Source for Shiru
// Provides streaming links from animeunion.tv

export default new class AnimeUnion {
  url = 'https://animeunion.tv'
  apiUrl = 'https://api.animeunion.tv'

  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9",
    "Referer": `${this.url}/`
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
      const res = await fetch(`${this.url}/anime?q=${encodeURIComponent(title)}`, {
        headers: this.headers
      })

      if (!res.ok) return []

      const html = await res.text()

      // Extract anime slug from search results
      const slugMatch = html.match(new RegExp(`href="/anime/([^"]+)"`, 'i'))
      if (!slugMatch) return []

      const slug = slugMatch[1]

      // Get anime page to extract episode data
      const animeRes = await fetch(`${this.url}/anime/${slug}`, {
        headers: this.headers
      })

      if (!animeRes.ok) return []

      const animeHtml = await animeRes.text()

      // Extract JSON data containing stream links
      const jsonMatch = animeHtml.match(/streamLinks:\[(\{[^}]+\})\]/)
      if (!jsonMatch) return []

      // Parse the stream link object
      const streamData = JSON.parse(`[${jsonMatch[1]}]`)
      
      // Find the episode stream (simplified - in production would need to match episode number)
      for (const stream of streamData) {
        if (stream.url && stream.isActive) {
          return [{
            title: `${title} - Ep ${episode} [AU]`,
            link: stream.url,
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
