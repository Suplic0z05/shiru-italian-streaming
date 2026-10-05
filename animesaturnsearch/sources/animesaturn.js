// AnimeSaturn Source for Shiru
// HTTP streaming provider for animesaturn.net (Italian subbed anime).
//
// ── Verified chain (re-measured 2026-10-05, six queries: One Piece, Naruto,
// ── Kimetsu no Yaiba, Pokemon, Shingeki no Kyojin, I Cavalieri dello Zodiaco)
// ── No interactive anti-bot wall: only a Cloudflare JSD script, no challenge.
// ── The as_session cookie is set but NOT required (verified cookieless).
//
// 1. search  GET /filter?key=<query>            -> 200 on all six
//    Results are the anchors with class="ac group". A naive href="/anime/"
//    sweep returns 35 links of which only 30 are real results: the first 5 are
//    a hero banner. Order is NOT relevance ("Naruto" returns
//    "Boruto: Naruto Next Generations" first), so selection is by title.
// 2. episodes  live at /episode/<slug>/ep-<N>    (NOT "/ep/...-ep-N": that
//    pattern has 0 occurrences on the page)
// 3. resolve, four plain fetches:
//    hop1  GET /api/watch/<slug>/ep-<N>  -> 200 JSON {episodeId, videoUrl}
//    hop2  GET <videoUrl>                -> ~5 KB shell, no player in the
//          HTML. The player only exists at runtime, so the inline
//          `window.__E={i:<id>,k:"<token>",e:<expires>}` is parsed out. i/k/e
//          are read from the embed shell and NOT assumed to equal the values
//          embedded in hop1's videoUrl (they do today, but that is not relied on).
//    hop3  GET https://play.saturncdn.net/embed/<i>/playlist?token=<k>&expires=<e>
//          -> 200 JSON {d, p, t}
//    hop4  decode `d` -> the real media URL (see below)
//    Tokens are time-based (expires ~ now + 12 h) and regenerate, so hops 2-4
//    run per episode and are never cached across calls.
//
// ── hop4 transform, derived empirically and recorded here on purpose ────────
// It is standard base64, then a repeating-key XOR whose key is the *ASCII
// bytes of the token string* (NOT the token's raw 16 hex bytes -- that
// produces garbage). The key was not taken on faith: assuming the plaintext
// starts with "https://" and recovering key[i] = cipher[i] ^ plaintext[i] for
// i<8 yields the first 8 bytes of the token's ASCII form exactly, e.g. for
// token d523809b7dff19d43106855e6e90d3a1 the implied keystream is
// 6435323338303962 = "d523809b". Decrypting with the full 32-char token then
// yields 112/112 printable ASCII bytes starting with "https://" and ending in
// a real media extension. The same transform also decodes `p` (poster) and
// `t` (thumbnails.vtt) into well-formed URLs, which is a second independent
// confirmation that it is the site-wide codec and not a coincidence of one
// sample.
//
// Measured sample (token above, d = "WBFGSBUOGk5ESkEABU1aAUhNDFEeQUxHAFBa..."):
//   cipher[0]=0x0c  key[0]='d'(0x64)  0x0c^0x64 = 0x68 = 'h'  -> "https://..."
//   full plaintext:
//   https://srv37.nezumi.streampeaker.org/_t/1791217147/CZ73Tlgxv_z27f_Z7WnnzQ/DDL/ANIME/OnePiece/0001/playlist.m3u8
//
// IMPORTANT CORRECTION to the assumption that every payload ends in .m3u8:
// it does not. The same codec emits progressive .mp4 for most other titles
// (Kimetsu, Shingeki verified 206 video/mp4). Accepting only .m3u8 silently
// threw away working streams -- see resolveEpisode().
//
// ── Why `hash` is EMPTY ───────────────────────────────────────────────────
// This site publishes HTTP progressive streams. It exposes no torrents, no
// magnets and no infohashes (measured: zero). `hash` is a required field and
// doubles as the dedupe key AND the infohash handed to Shiru's BitTorrent
// engine, so a fabricated 40-hex string would look like a valid result while
// being unresolvable. An empty hash plus the direct stream URL in `link` is
// the honest encoding of "playable, but not a torrent".

const BASE = 'https://www.animesaturn.net'
const PLAY = 'https://play.saturncdn.net'

// Hosts that must never leak into a `link`. The only iframe on an episode page
// is //acceptable.a-ads.com/... i.e. an advertisement; the previous version of
// this file used <iframe src> as its video fallback and handed that ad URL to
// the player. Iframes are never consulted, and these hosts are rejected
// explicitly as a second line of defence.
const AD_HOSTS = ['a-ads.com', 'adservice.', 'googlesyndication.com', 'doubleclick.net']

/** lowercase, strip diacritics, drop every non-alphanumeric char. */
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const isAdHost = (u) => {
  try {
    const h = new URL(u).hostname.toLowerCase()
    return AD_HOSTS.some((bad) => h === bad || h.endsWith('.' + bad) || h.includes(bad))
  } catch {
    return true // unparseable URL is not something we will hand to a player
  }
}

/**
 * Pack results into the shape the real loader actually consumes.
 *
 * MEASURED on Shiru 6.9.0 `worker.js`: there are TWO different shapes in play
 * and they are easy to confuse.
 *
 *   - `:119`  promises.push(this._querySource(...))  -> consumed at `:124-125`
 *              as `res.results` / `res.errors`. That is the WRAPPER's return.
 *   - `:141`  promises.push(source.single(options))   -> consumed at `:150`
 *              as `results.push(...result.value)`. That is the SOURCE's return,
 *              and it is SPREAD AS AN ARRAY.
 *
 * A `{results, errors}` object returned from `single()` therefore throws
 * `TypeError: Spread syntax requires ...iterable`, and `_querySource()` swallows
 * it as a rejected promise, so the source reports "found no results" instead of
 * crashing. `index.d.ts:107` (`Promise<TorrentResult[]>`) is correct; the
 * `{results, errors}` pair belongs to the wrapper, one layer up.
 *
 * `errors` on the returned array is a property the host NEVER reads: the worker
 * builds its own list at `:147` and fills it only from REJECTED promises
 * (`:153`). `pack()` is therefore the exit for a GENUINE NO-MATCH and for the
 * success path -- an empty array with a diagnostic riding along is exactly right
 * there. See `settle()` for a real failure.
 */
const pack = (results, errors) => {
  const out = Array.isArray(results) ? [...results] : []
  out.errors = [...errors]
  return out
}

/**
 * Exit for a REAL FAILURE: rejects, so the cause actually reaches the user.
 *
 * Measured on Shiru 6.9.0. `worker.js:153` builds the host error list exclusively
 * from `result.status === 'rejected'`; it never reads a returned value's
 * diagnostics. So returning an empty array plus a detailed diagnostic degrades to
 * `worker.js:127` synthesising "Source animesaturn-it found no results.", and
 * `handler.js:118` throws precisely that string to the UI -- the real cause
 * (search 404, expired CDN playlist, rejected ad host) is hidden behind a message
 * that blames nothing. `handler.js:116-117` is the only path that surfaces a
 * specific message, and it is reached solely by a rejection.
 *
 * Rejecting is safe and isolated: every entry point runs inside
 * `Promise.allSettled` (`worker.js:141-143`), so one rejection becomes one
 * user-visible message and cannot take down the sibling entry points.
 *
 * Degrades to `pack()` when there is no message to report. That matters: an
 * episode absent upstream (`resolveEpisode` -> `{noMatch:true}`) carries an EMPTY
 * diagnostics list because nothing went wrong, and `handler.js:116` joins the
 * messages with `|| 'Unknown error'` -- throwing there would surface the literal
 * string "Unknown error", which is worse than an honest "found no results".
 */
const settle = (results, errors) => {
  const out = pack(results, errors)
  if (!out.errors.length) return out
  const err = new Error(out.errors.join(' | '))
  err.errors = out.errors // structured diagnostics, for logs and verify.mjs
  throw err
}

export default new class AnimeSaturn {
  url = BASE

  headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9',
    Referer: `${BASE}/`
  }

  /** fetch that never throws: returns {ok, status, body} and records failures. */
  async grab(url, extra = {}) {
    try {
      const res = await fetch(url, {
        headers: { ...this.headers, ...extra },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      })
      return { ok: res.ok, status: res.status, body: await res.text(), res }
    } catch (e) {
      return { ok: false, status: 0, body: '', error: e?.message || String(e) }
    }
  }

  async grabJson(url, extra = {}) {
    const r = await this.grab(url, { Accept: 'application/json', ...extra })
    if (!r.ok) return { ok: false, status: r.status, error: r.error, data: null }
    try {
      return { ok: true, status: r.status, data: JSON.parse(r.body) }
    } catch (e) {
      return { ok: false, status: r.status, error: `JSON non valido: ${e.message}`, data: null }
    }
  }

  // ── search results ───────────────────────────────────────────────────────

  /** Pull the real result cards out of /filter. `class="ac group"` is required. */
  parseCandidates(html) {
    const out = []
    const re = /<a href="\/anime\/([^"]+)" class="ac group"[\s\S]*?<\/a>/g
    let m
    while ((m = re.exec(html)) !== null) {
      const block = m[0]
      const pick = (r) => (block.match(r) || [])[1]
      const title = (
        pick(/class="ac__title">([\s\S]*?)<\/h3>/) ||
        pick(/<img[^>]+alt="([^"]*)"/) ||
        ''
      )
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .trim()

      const sub = (pick(/class="ac__sub">([\s\S]*?)<\/p>/) || '')
        .replace(/&middot;/g, '·')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .trim()

      // ac__score wraps an inline <svg> star, so the tags go before parsing.
      const scoreRaw = (pick(/class="ac__score">([\s\S]*?)<\/span>\s*<\/div>/) || '').replace(
        /<svg[\s\S]*?<\/svg>/g,
        ''
      )
      const score = parseFloat((scoreRaw.match(/(\d+(?:\.\d+)?)/) || [])[1] ?? '')

      out.push({
        slug: m[1],
        title,
        nrm: norm(title),
        type: (pick(/class="ac__type-badge">([\s\S]*?)<\/span>/) || '').trim(),
        score: Number.isNaN(score) ? null : score,
        sub,
        year: (sub.match(/(\d{4})/) || [])[1] ?? null,
        // The site renders the count literally as "?? ep" on some cards; that
        // is NOT a parse failure, it just means "unknown".
        episodes: (sub.match(/·\s*(\d+)\s*ep/i) || [])[1] ?? null,
        rank: out.length
      })
      if (!title) continue
    }
    return out
  }

  /**
   * Rank a candidate against every title the host gave us.
   * 3 exact | 2 startswith (either direction) | 1 contains | 0 no relation.
   */
  tierFor(cand, queryTitles) {
    let best = 0
    for (const t of queryTitles) {
      const q = norm(t)
      if (!q || !cand.nrm) continue
      let tier = 0
      if (cand.nrm === q) tier = 3
      else if (cand.nrm.startsWith(q) || q.startsWith(cand.nrm)) tier = 2
      else if (cand.nrm.includes(q) || q.includes(cand.nrm)) tier = 1
      if (tier > best) best = tier
      if (best === 3) break
    }
    return best
  }

  /**
   * Pick the best card. Order is by tier, then by candidate length (closest to
   * the query wins, so "Pokemon (ITA)" beats "Pokemon (2019)"), then score,
   * then the site's own rank. Deliberately never "first result".
   */
  pickByTitle(candidates, queryTitles) {
    let best = null
    let bestTier = 0
    for (const c of candidates) {
      const tier = this.tierFor(c, queryTitles)
      if (tier === 0) continue
      if (
        !best ||
        tier > bestTier ||
        (tier === bestTier && c.nrm.length < best.nrm.length) ||
        (tier === bestTier && c.nrm.length === best.nrm.length && (c.score ?? 0) > (best.score ?? 0))
      ) {
        best = c
        bestTier = tier
      }
    }
    return bestTier ? { card: best, tier: bestTier } : null
  }

  /**
   * Second chance, used when no card title matches lexically at all.
   *
   * This is not hypothetical: the query "Shingeki no Kyojin" has ZERO lexical
   * overlap with any of the 21 cards, because the site is Italian and calls the
   * series "L'attacco dei Giganti". Rule-based matching would return empty for
   * a perfectly good result. The anime page carries schema.org JSON-LD
   * (TVSeries) whose `alternateName` is the original title
   * ("alternateName":"Shingeki no Kyojin"), so the site itself supplies the
   * mapping and we match on it instead of guessing.
   *
   * TV/DUB cards are scanned first (series 1 is the usual intent), capped so a
   * bad query cannot fan out over the whole catalogue.
   */
  async pickByAlternateName(candidates, queryTitles, errors, maxPages = 10) {
    const series = candidates.filter((c) => /^(tv|dub)$/i.test(c.type))
    const order = [...series, ...candidates.filter((c) => !series.includes(c))]
    const found = []
    let seen = 0

    for (const c of order) {
      if (seen >= maxPages) break
      seen++
      const page = await this.grab(`${BASE}/anime/${c.slug}`)
      if (!page.ok) continue

      const ld = (page.body.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
      ) || [])
        .map((s) => s.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, ''))
        .map((s) => {
          try {
            return JSON.parse(s)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      for (const d of ld) {
        if (!d || !d.name) continue
        const alts = [d.name].concat(
          Array.isArray(d.alternateName) ? d.alternateName : d.alternateName ? [d.alternateName] : []
        )
        const probe = { nrm: norm(d.alternateName) }
        let tier = 0
        for (const t of queryTitles) {
          const q = norm(t)
          if (!q || !probe.nrm) continue
          if (probe.nrm === q) tier = Math.max(tier, 3)
          else if (probe.nrm.startsWith(q) || q.startsWith(probe.nrm)) tier = Math.max(tier, 2)
          else if (probe.nrm.includes(q) || q.includes(probe.nrm)) tier = Math.max(tier, 1)
        }
        if (tier > 0) {
          found.push({
            card: c,
            tier,
            nrm: probe.nrm,
            type: d['@type'] || '',
            published: d.datePublished || ''
          })
        }
      }
      if (found.some((f) => f.tier === 3)) break
    }

    if (!found.length) return null
    found.sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier
      if (a.nrm.length !== b.nrm.length) return a.nrm.length - b.nrm.length
      return String(a.published).localeCompare(String(b.published))
    })
    if (seen >= maxPages && found.length) {
      // recorded, but deliberately not treated as a failure: the source worked
      errors.push(`ricerca per titolo alternativo: esaminate ${seen} schede (limite ${maxPages})`)
    }
    return { card: found[0].card, tier: found[0].tier, via: 'alternateName' }
  }

  // ── hop 4 codec ──────────────────────────────────────────────────────────

  /** base64 -> repeating-key XOR keyed with the token's ASCII bytes. */
  decodeField(b64, token) {
    const cipher = Buffer.from(String(b64), 'base64')
    if (!cipher.length) return ''
    const key = Buffer.from(String(token), 'utf8')
    const out = Buffer.from(cipher.map((b, i) => b ^ key[i % key.length]))
    return out.toString('utf8')
  }

  // ── the four hops ────────────────────────────────────────────────────────

  /**
   * Resolve one episode to a playable .m3u8.
   * @returns {Promise<{url?:string, error?:string, noMatch?:boolean}>}
   */
  async resolveEpisode(slug, episode) {
    const epPage = `${BASE}/anime/${slug}/ep-${episode}`

    // hop 1
    const w = await this.grabJson(`${BASE}/api/watch/${slug}/ep-${episode}`, {
      Referer: epPage,
      'X-Requested-With': 'XMLHttpRequest'
    })
    if (!w.ok) {
      if (w.status === 404) {
        // The anime exists (we found it via search) but that episode does not.
        // That is a genuine empty answer, not a broken source.
        return { noMatch: true }
      }
      return {
        error: `hop1 /api/watch/${slug}/ep-${episode} HTTP ${w.status}${w.error ? ' ' + w.error : ''}`
      }
    }
    const videoUrl = w.data?.videoUrl
    if (!videoUrl) {
      return { error: `hop1 senza videoUrl (episodeId=${w.data?.episodeId ?? '?'})` }
    }

    // hop 2 - the embed shell holds no player markup, only the runtime config
    const shell = await this.grab(videoUrl, { Referer: epPage })
    if (!shell.ok) return { error: `hop2 ${videoUrl} HTTP ${shell.status}` }

    const cfg = (shell.body.match(/window\.__E\s*=\s*\{([^}]*)\}/) || [])[1]
    if (!cfg) {
      return { error: `hop2 ${videoUrl}: script window.__E non trovato (layout cambiato?)` }
    }
    const g = (k) => {
      const v = (cfg.match(new RegExp(k + '\\s*:\\s*"?([^,"}]+)"?')) || [])[1]
      return v ? v.trim() : null
    }
    const i = g('i')
    const k = g('k')
    const e = g('e')
    if (!i || !k || !e) {
      return { error: `hop2 ${videoUrl}: __E incompleto (i=${i} k=${k} e=${e})` }
    }

    // hop 3
    const pl = `${PLAY}/embed/${i}/playlist?token=${k}&expires=${e}`
    const p = await this.grabJson(pl, { Referer: videoUrl, Origin: BASE })
    if (!p.ok) return { error: `hop3 ${pl} HTTP ${p.status}${p.error ? ' ' + p.error : ''}` }
    if (!p.data?.d) return { error: `hop3 ${pl}: payload senza campo "d"` }

    // hop 4
    //
    // The accepted shape is broader than "must end in .m3u8". Measured: the
    // site serves TWO payload shapes from the same endpoint --
    //   HLS master playlist  srv37.nezumi.streampeaker.org/_t/<exp>/<sig>/DDL/ANIME/OnePiece/0001/playlist.m3u8
    //   progressive MP4      srv13.sakuranbo.streampeaker.org/DDL/ANIME/KimetsuNoYaiba/KimetsuNoYaiba_Ep_01_SUB_ITA.mp4?token=..&expires=..
    // Both are genuine and playable (the .mp4 answers 206 video/mp4 with a
    // valid ftyp/isom header, ~261 MB). Gating on .m3u8 alone threw away
    // working streams for most of the catalogue, so both are accepted; a
    // decode must still be an absolute https URL to a media file.
    const media = this.decodeField(p.data.d, k)
    if (!/^https:\/\/\S+$/.test(media)) {
      return {
        error: `hop4 decodifica fallita su ${pl}: ottenuto ${JSON.stringify(media.slice(0, 40))}`
      }
    }
    if (!/\.(m3u8|mp4|m4v|webm)(\?|$)/i.test(media)) {
      return {
        error: `hop4 URL non-media su ${pl}: ${JSON.stringify(media.slice(0, 60))}`
      }
    }
    if (isAdHost(media)) {
      return { error: `hop4 rifiutato: host pubblicitario nel media ${media}` }
    }
    return { url: media }
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Resolve a single episode.
   *
   * Returns a real ARRAY on the two exits that are NOT failures -- the success
   * path, and a genuine no-match. The loader spreads the resolved value
   * (`worker.js:151`), so anything non-iterable there is a hard TypeError.
   *
   * On a REAL failure this REJECTS instead, because that is the only route by
   * which the cause reaches the user: the loader builds its message list from
   * rejected promises alone (`worker.js:153`) and `handler.js:116-117` throws
   * that text to the UI, whereas a returned empty array is reported as the
   * contentless "Source animesaturn-it found no results." (`worker.js:127` +
   * `handler.js:118`). Rejections are isolated per entry point by
   * `Promise.allSettled` (`worker.js:141-143`), so `movie()` is unaffected by a
   * throw from `single()`.
   *
   * `.errors` is attached in every case and is diagnostic only: the host never
   * reads it from a fulfilled value. It is retained so verify.mjs and any log
   * line can see the detail, and on the throwing path it also rides on the
   * Error as `err.errors`.
   * @returns {Promise<object[]>}
   */
  async single(query) {
    const errors = []
    const titles = (query?.titles ?? []).filter(Boolean)
    const episode = Number(query?.episode) > 0 ? Number(query.episode) : 1

    // Not a throw, deliberately. `handler.js:316-338` builds `titles` from AniList
    // media filtered on `length > 3`, so `[]` is reachable when an entry has no
    // romaji/english title: a HOST-side data gap, not a broken source, and
    // "found no results" is the accurate thing to tell the user. Rejecting here
    // would blame AnimeSaturn for the host's missing data. The diagnostic is kept
    // in `.errors` so the case stays visible. To surface it instead, swap `pack`
    // for `settle` on this one line.
    if (!titles.length) return pack([], ['query.titles vuoto o assente'])

    // step 1 - search
    const searchUrl = `${BASE}/filter?key=${encodeURIComponent(titles[0])}`
    const page = await this.grab(searchUrl, { Referer: `${BASE}/` })
    if (!page.ok) {
      return settle([], [
        `ricerca ${searchUrl} HTTP ${page.status}${page.error ? ' ' + page.error : ''}`
      ])
    }

    const candidates = this.parseCandidates(page.body)
    if (!candidates.length) {
      // The site ships its own empty-state markup ("Nessun anime trovato" /
      // "Niente trovato per"). That is a genuine no-match, so it RETURNS an
      // empty array and lets the host say "found no results", which is the
      // truthful message for it. Every other branch here means the site answered
      // something we could not use, so it rejects and names the reason.
      if (/Pagina non trovata/i.test(page.body)) {
        return settle([], [`ricerca ${searchUrl}: pagina 404 del sito (rotta cambiata?)`])
      }
      if (/Nessun anime trovato|Nessun risultato|Niente trovato/i.test(page.body)) {
        return pack([], errors) // genuine no-match
      }
      return settle(
        [],
        [`ricerca ${searchUrl}: nessuna scheda "ac group" nel markup (layout cambiato?)`]
      )
    }

    // step 2 - pick the right series by title, never by position
    let picked = this.pickByTitle(candidates, titles)
    let via = 'titolo'
    if (!picked) {
      picked = await this.pickByAlternateName(candidates, titles, errors)
      via = 'titolo alternativo'
    }
    if (!picked) {
      return settle(
        [],
        errors.length
          ? errors
          : [`nessuna scheda corrisponde a "${titles[0]}" (titolo e titolo alternativo)`]
      )
    }

    const card = picked.card

    // step 3 - four hops to a media URL
    const res = await this.resolveEpisode(card.slug, episode)
    if (res.error) return settle([], [res.error])
    if (res.noMatch || !res.url) {
      // Nothing failed here: the series exists, that episode simply does not.
      // No diagnostic -> no throw, the host reports "found no results".
      return settle([], errors)
    }
    if (isAdHost(res.url)) {
      return settle([], [`rifiutato host pubblicitario: ${res.url}`])
    }

    return pack(
      [
        {
          title: `${card.title} - Ep ${episode} [AS]`,
          link: res.url,
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: 'high',
          // EMPTY ON PURPOSE. Animesaturn streams over HTTP and publishes no
          // torrent/magnet/infohash, while Shiru's BitTorrent engine needs one
          // here. A made-up hash would be a plausible-looking dead result.
          hash: '',
          size: 0,
          date: new Date(),
          type: 'best',
          // provenance, harmless for the host and useful in a log line
          source: 'animesaturn',
          matchedBy: via,
          animeSlug: card.slug,
          animeTitle: card.title,
          animeType: card.type,
          animeScore: card.score
        }
      ],
      errors
    )
  }

  /** No batch releases on this site. */
  async batch() {
    return pack([], [])
  }

  async movie(query) {
    return this.single({ ...query, episode: 1 })
  }

  /** Cheapest meaningful liveness probe. */
  async validate() {
    const r = await this.grab(this.url, { 'X-Requested-With': 'XMLHttpRequest' })
    return !!r.ok
  }
}