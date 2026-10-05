#!/usr/bin/env node
// verify.mjs — livello di verifica per le estensioni Shiru di questo repository.
//
// Due modalità, scelte da flag:
//
//   --offline  (default)  controlli statici, NESSUNA richiesta di rete.
//   --live                controlli statici + esecuzione reale di validate()/single()
//                         con tracciamento di ogni fetch emesso da ciascun modulo.
//
// Solo Node standard library: nessuna dipendenza, nessun npm install.
// Le directory delle estensioni vengono SCOPERTE dal filesystem: nessun nome
// è hardcoded, così aggiungere un'estensione non richiede di toccare questo file.
//
// Il tool è di sola lettura sul repository: non scrive, non corregge, non cancella.
// I difetti che trova vengono solo riportati.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO = fileURLToPath(new URL('..', import.meta.url))

// Directory dentro la radice che non sono estensioni, anche se un giorno
// contenessero un index.json (non devono farlo, ma non costa nulla escluderle).
const NOT_EXTENSION_DIRS = new Set(['node_modules', '.git', 'scripts', '.github', 'dist', 'build', 'vendor'])

// Metodi che la specifica (TorrentSource) descrive su ogni fonte torrent.
const EXPECTED_METHODS = ['validate', 'single', 'batch', 'movie']

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const REPO_MAIN_RE = /^gh:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/\S*)?$/

const SPEEDS = ['fast', 'moderate', 'slow']
const ACCURACIES = ['high', 'medium', 'low']

// Query realistica, plasmata su TorrentQuery in index.d.ts.
// I nomi dei campi non sono inventati: vengono verificati contro la spec a runtime
// (vedi deriveTorrentQueryFields e il blocco "campi TorrentQuery" in renderHuman)
// e un disaccordo è riportato come warning.
const SAMPLE_QUERY = {
  anilistId: 21,
  media: { id: 21, format: 'TV', type: 'ANIME', episodes: 1100, status: 'RELEASING' },
  titles: ['One Piece'],
  episode: 1,
  episodeCount: 1100,
  resolution: '1080',
  exclusions: [],
}

// ---------------------------------------------------------------------------
// Segnali anti-bot.
//
// Nota importante, eNON è una prova di muro: animeworld.ac serve
// /cdn-cgi/challenge-platform/scripts/jsd/main.js anche nelle pagine normali
// (HTTP 200 verificado). Per questo quel marker ha peso 'debole' e viene
// riportato come sospetto con la ragione, mai come verdetto.
// La stringa "cloudflare" da sola NON viene usata come segnale: compare anche
// nelle pagine d'errore 404 e 521, dove non è un muro.
const WALL_SIGNALS = [
  {
    id: 'cf-title-challenge',
    label: 'titolo di pagina di verifica Cloudflare ("Just a moment" / "Attention Required")',
    weight: 'strong',
    test: /<title>\s*(just a moment|attention required)/i,
  },
  {
    id: 'cf-browser-verification',
    label: 'script cf-browser-verification',
    weight: 'strong',
    test: /cf-browser-verification/i,
  },
  {
    id: 'cf-challenge-node',
    label: 'nodo di challenge Cloudflare (__cf_chl_ / cf_chl_opt)',
    weight: 'strong',
    test: /__cf_chl_|cf_chl_opt|window\._cf_chl_/i,
  },
  {
    id: 'cf-checking-browser',
    label: 'testo "Checking your browser before accessing"',
    weight: 'strong',
    test: /checking your browser before accessing/i,
  },
  {
    id: 'cf-js-cookies-required',
    label: 'testo "Enable JavaScript and cookies to continue"',
    weight: 'strong',
    test: /enable javascript and cookies to continue/i,
  },
  {
    id: 'challenge-platform',
    label: 'script /cdn-cgi/challenge-platform/ — serve anche su pagine normali, NON è prova di muro',
    weight: 'weak',
    test: /\/cdn-cgi\/challenge-platform\//i,
  },
]

// ---------------------------------------------------------------------------
// Raccolta dei risultati
// ---------------------------------------------------------------------------

const findings = []

function report(level, scope, code, message, detail) {
  findings.push({ level, scope, code, message, ...(detail ? { detail } : {}) })
}
const error = (scope, code, msg, detail) => report('error', scope, code, msg, detail)
const warn = (scope, code, msg, detail) => report('warn', scope, code, msg, detail)
const info = (scope, code, msg, detail) => report('info', scope, code, msg, detail)

function countLevel(level) {
  return findings.filter((f) => f.level === level).length
}

// ---------------------------------------------------------------------------
// Utility filesystem
// ---------------------------------------------------------------------------

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readText(p) {
  return readFileSync(p, 'utf8')
}

function readJson(p) {
  // Restituisce { ok, value, error } invece di lanciare: un JSON malformato è
  // un difetto del repository da riportare, non un crash del tool.
  try {
    return { ok: true, value: JSON.parse(readText(p)) }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// Scopre le estensioni dalla radice: ogni sotto-directory con un index.json
// leggibile è un'estensione. Nessun nome hardcoded.
function discoverExtensions(repo) {
  const found = []
  for (const entry of readdirSync(repo, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (NOT_EXTENSION_DIRS.has(entry.name)) continue
    const dir = join(repo, entry.name)
    if (!isFile(join(dir, 'index.json'))) continue
    found.push(entry.name)
  }
  return found.sort()
}

// Elenco dei file .js sotto <ext>/sources/ (ricorsivo).
function listSourceFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && extname(entry.name) === '.js') out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

// ---------------------------------------------------------------------------
// Estrazione dalla specifica index.d.ts
//
// I valori legali di `type` NON sono hardcoded: vengono letti a runtime dal
// blocco SourceConfig del file di specifica, che è la fonte di verità in-repo.
// Se domani la specifica, il tool deve accorgersene senza rompersi.
// ---------------------------------------------------------------------------

function stripLineComments(text) {
  return text
    .split('\n')
    .map((l) => {
      const idx = l.indexOf('//')
      return idx === -1 ? l : l.slice(0, idx)
    })
    .join('\n')
}

// Estrae il corpo di un blocco {...} partendo dalla dichiarazione `header`.
function extractBlock(text, headerRe) {
  const m = text.match(headerRe)
  if (!m) return null
  const start = text.indexOf('{', m.index)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

// type ammessi: dalla prop `type` dentro SourceConfig.
// Restituisce { values, declared, reason } — `values` è null se non è
// determinabile dalla specifica (in quel caso nessun valore viene respinto).
function deriveSourceTypes(specText) {
  const cleaned = stripLineComments(specText)
  const block = extractBlock(cleaned, /export\s+interface\s+SourceConfig\s*\{/)
  if (!block) return { values: null, declared: false, reason: 'blocco SourceConfig non trovato in index.d.ts' }

  const prop = block.match(/^\s*type\s*\??\s*:\s*(.+?)\s*$/m)
  if (!prop) return { values: null, declared: false, reason: 'SourceConfig non dichiara la prop `type`' }

  const literals = [...prop[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
  if (literals.length === 0) {
    return {
      values: null,
      declared: false,
      reason: `la prop \`type\` è "${prop[1].trim()}" e non contiene valori letterali: nessun insieme legale derivabile`,
    }
  }
  return { values: [...new Set(literals)], declared: true, reason: 'derivato da SourceConfig.type in index.d.ts' }
}

// Campi dichiarati in TorrentQuery (per auto-verificare la query di --live).
function deriveTorrentQueryFields(specText) {
  const cleaned = stripLineComments(specText)
  const block = extractBlock(cleaned, /export\s+interface\s+TorrentQuery\s*\{/)
  if (!block) return null
  const fields = new Set()
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/)
    if (m) fields.add(m[1])
  }
  return fields.size ? [...fields] : null
}

// Valori ammessi per `resolution` in TorrentQuery.
function deriveResolutionValues(specText) {
  const cleaned = stripLineComments(specText)
  const block = extractBlock(cleaned, /export\s+interface\s+TorrentQuery\s*\{/)
  if (!block) return null
  const prop = block.match(/^\s*resolution\s*\??\s*:\s*(.+?)\s*$/m)
  if (!prop) return null
  return [...prop[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
}

// ---------------------------------------------------------------------------
// Controlli statici
// ---------------------------------------------------------------------------

const EXT_METHOD_FIELDS = [
  { field: 'id', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
  { field: 'name', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
  { field: 'version', test: (v) => typeof v === 'string' && SEMVER_RE.test(v), label: 'SemVer stretto (x.y.z)' },
  { field: 'main', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
  { field: 'update', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
  { field: 'speed', test: (v) => SPEEDS.includes(v), label: `uno di ${SPEEDS.join(', ')}` },
  { field: 'accuracy', test: (v) => ACCURACIES.includes(v), label: `uno di ${ACCURACIES.join(', ')}` },
  {
    field: 'regions',
    test: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0),
    label: 'array non vuoto di stringhe',
  },
  { field: 'description', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
  { field: 'icon', test: (v) => typeof v === 'string' && v.trim().length > 0, label: 'stringa non vuota' },
]

function checkRootIndex(spec) {
  const p = join(REPO, 'index.json')
  if (!isFile(p)) {
    error('repo', 'root-index-missing', 'index.json manca nella radice del repository')
    return null
  }
  const parsed = readJson(p)
  if (!parsed.ok) {
    error('repo', 'root-index-parse', `index.json non è JSON valido: ${parsed.error}`)
    return null
  }
  if (!Array.isArray(parsed.value)) {
    error('repo', 'root-index-not-array', `index.json deve essere un array, trovato ${describe(parsed.value)}`)
    return null
  }
  if (parsed.value.length === 0) {
    warn('repo', 'root-index-empty', 'index.json è un array vuoto: nessuna estensione pubblicata')
  }
  const mains = []
  parsed.value.forEach((entry, i) => {
    const where = `index.json[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      error(where, 'entry-shape', `la voce deve essere un oggetto, trovato ${describe(entry)}`)
      return
    }
    if (typeof entry.main !== 'string' || entry.main.trim() === '') {
      error(where, 'main-shape', `\`main\` deve essere una stringa non vuota, trovato ${describe(entry.main)}`)
      return
    }
    if (!REPO_MAIN_RE.test(entry.main)) {
      error(
        where,
        'main-format',
        `\`main\` non ha la forma gh:owner/repo[/subdir]: ${JSON.stringify(entry.main)}`,
        { value: entry.main },
      )
    }
    mains.push(entry.main)
  })
  spec.rootIndex = { count: parsed.value.length, mains }
  return mains
}

// Risolve `main` su un file reale: prova il percorso esatto, poi quello con `.js`.
// Riporta quale forma ha risolto: la specifica suggerisce il path SENZA estensione
// (vedi commento in index.d.ts), mentre package.json la mette. Entrambe le forme
// sono accettate, ma la differenza viene segnalata.
function resolveMain(extDir, main) {
  const exact = join(extDir, main)
  if (isFile(exact)) return { resolved: exact, form: 'esatto', path: main }
  const withExt = `${exact}.js`
  if (isFile(withExt)) return { resolved: withExt, form: 'con-estensione', path: `${main}.js` }
  return { resolved: null, form: 'mancante', path: null }
}

function checkExtension(dirName, spec, repoMains) {
  const scope = dirName
  const extDir = join(REPO, dirName)
  const rec = { dir: dirName, id: null, name: null, versions: {}, mainForm: null, sources: [], methods: {} }

  // --- manifest ------------------------------------------------------------
  const manifestPath = join(extDir, 'index.json')
  const parsed = readJson(manifestPath)
  if (!parsed.ok) {
    error(scope, 'manifest-parse', `index.json non è JSON valido: ${parsed.error}`)
    return rec
  }
  if (!Array.isArray(parsed.value)) {
    error(scope, 'manifest-not-array', `index.json deve essere un array, trovato ${describe(parsed.value)}`)
    return rec
  }
  if (parsed.value.length === 0) {
    error(scope, 'manifest-empty', 'index.json è un array vuoto')
    return rec
  }
  rec.manifestCount = parsed.value.length

  parsed.value.forEach((source, i) => {
    const where = `${dirName}/index.json[${i}]`
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      error(where, 'source-shape', `la fonte deve essere un oggetto, trovato ${describe(source)}`)
      return
    }
    if (i === 0) {
      rec.id = typeof source.id === 'string' ? source.id : null
      rec.name = typeof source.name === 'string' ? source.name : null
      rec.type = typeof source.type === 'string' ? source.type : null
      rec.versions.manifest = typeof source.version === 'string' ? source.version : null
    }

    for (const f of EXT_METHOD_FIELDS) {
      if (!f.test(source[f.field])) {
        error(where, `field-${f.field}`, `\`${f.field}\` deve essere ${f.label}, trovato ${describe(source[f.field])}`)
      }
    }

    // name ≤ 16 caratteri: limite esplicito nella specifica.
    if (typeof source.name === 'string' && [...source.name].length > 16) {
      error(
        where,
        'name-too-long',
        `\`name\` supera i 16 caratteri consentiti dalla specifica: ${[...source.name].length} caratteri (${JSON.stringify(source.name)})`,
      )
    }

    // type: insieme legale derivato dalla specifica, mismatch = WARNING (la
    // specifica può crescere e questo tool non deve fallire duro su un cambio).
    if ('type' in source) {
      if (spec.sourceTypes.values === null) {
        warn(
          where,
          'type-undeterminable',
          `\`type\` = ${JSON.stringify(source.type)} non verificabile: ${spec.sourceTypes.reason}`,
        )
      } else if (typeof source.type !== 'string') {
        warn(where, 'type-shape', `\`type\` dovrebbe essere una stringa, trovato ${describe(source.type)}`)
      } else if (!spec.sourceTypes.values.includes(source.type)) {
        warn(
          where,
          'type-out-of-spec',
          `\`type\` = ${JSON.stringify(source.type)} non è fra i valori dichiarati dalla specifica [${spec.sourceTypes.values.join(', ')}]`,
          { specValues: spec.sourceTypes.values },
        )
      }
    }

    // main → file reale
    if (typeof source.main === 'string' && source.main.trim() !== '') {
      const r = resolveMain(extDir, source.main)
      rec.mainForm = r.form
      rec.resolvedMain = r.resolved
      if (!r.resolved) {
        error(
          where,
          'main-unresolved',
          `\`main\` = ${JSON.stringify(source.main)} non risolve nessun file (provati ${relative(REPO, join(extDir, source.main))} e ${relative(REPO, join(extDir, source.main))}.js)`,
        )
      } else if (r.form === 'con-estensione') {
        info(
          where,
          'main-ext-added',
          `\`main\` = ${JSON.stringify(source.main)} risolve solo con l'estensione aggiunta: ${r.path}`,
          { resolved: r.path },
        )
      }
    }
  })

  // --- versioni ------------------------------------------------------------
  const pkg = readJson(join(extDir, 'package.json'))
  rec.versions.package = pkg.ok && pkg.value && typeof pkg.value.version === 'string' ? pkg.value.version : null
  if (!pkg.ok) {
    warn(scope, 'package-parse', `package.json non è JSON valido: ${pkg.error}`)
  } else if (rec.versions.package === null) {
    warn(scope, 'package-no-version', 'package.json non dichiara `version`')
  }
  rec.versions.root = spec.rootVersion
  rec.versions.aligned = rec.versions.manifest === rec.versions.package

  const distinct = [rec.versions.manifest, rec.versions.package].filter((v) => typeof v === 'string')
  if (new Set(distinct).size > 1) {
    warn(
      scope,
      'version-mismatch-ext',
      `versione discordante tra index.json (${rec.versions.manifest}) e package.json (${rec.versions.package})`,
    )
  }
  if (spec.rootVersion && rec.versions.manifest && rec.versions.manifest !== spec.rootVersion) {
    warn(
      scope,
      'version-mismatch-root',
      `versione della fonte (${rec.versions.manifest}) diversa dalla versione radice (${spec.rootVersion})`,
    )
  }

  // main del manifest vs main del package.json: divergenza tollerata
  // (index.d.ts suggerisce il path senza .js) ma utile da vedere.
  if (pkg.ok && pkg.value && typeof pkg.value.main === 'string' && Array.isArray(parsed.value) && parsed.value[0]) {
    rec.packageMain = pkg.value.main
    const m0 = parsed.value[0].main
    if (typeof m0 === 'string' && m0 !== pkg.value.main) {
      info(
        scope,
        'main-mismatch-package',
        `\`main\` diverso: index.json ${JSON.stringify(m0)} vs package.json ${JSON.stringify(pkg.value.main)}`,
      )
    }
  }

  // --- coerenza con l'indice radice --------------------------------------
  if (Array.isArray(repoMains) && repoMains.length > 0) {
    const tail = `/${dirName}`
    const listed = repoMains.some((m) => typeof m === 'string' && (m === `gh:${repoSlug()}${tail}` || m.endsWith(tail)))
    rec.listedInRootIndex = listed
    if (!listed) {
      warn(scope, 'not-listed-root', `nessuna voce di index.json radice punta a /${dirName}`)
    }
  }

  // --- sorgenti ------------------------------------------------------------
  const sourcesDir = join(extDir, 'sources')
  if (!isDir(sourcesDir)) {
    warn(scope, 'no-sources-dir', 'manca la directory sources/')
    return rec
  }
  const files = listSourceFiles(sourcesDir)
  if (files.length === 0) {
    error(scope, 'no-source-files', 'nessun file .js sotto sources/')
    return rec
  }
  rec.sourceFiles = files.map((f) => relative(extDir, f))
  return rec
}

function repoSlug() {
  const owner = 'Suplic0z05'
  const name = readJson(join(REPO, 'package.json'))
  return `${owner}/${name.ok && name.value && name.value.name ? name.value.name : 'shiru-italian-streaming'}`
}

function describe(v) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array(${v.length})`
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}…` : v)
  if (typeof v === 'object') return `object(${Object.keys(v).join(',')})`
  return `${typeof v} ${String(v)}`
}

// ---------------------------------------------------------------------------
// Importazione dei moduli + forma dell'export
//
// node --check non viene usato: su Node 26 lo statement `export` viene
// comunque accettato, ma l'unico controllo che vale davvero è l'importazione
// reale, che dimostra insieme (a) che il file è un modulo ESM valido e
// (b) com'è fatta la sua export. Un import per file, senza processi figli.
//
// In --offline globalThis.fetch viene sostituita con una guardia che registra
// e rifiuta: se un modulo facesse una richiesta a import-time, l'import
// fallirebbe e il difetto verrebbe riportato. In questo modo l'assunzione
// "nessuna rete all'importazione" è verificata, non assunta.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch.bind(globalThis)

function installImportGuard(rec) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input)
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    rec.importScopeCalls.push(`${method} ${url}`)
    throw new Error(`verify.mjs --offline: rete bloccata durante l'import di ${rec.dir} (${method} ${url})`)
  }
}

function restoreFetch() {
  globalThis.fetch = realFetch
}

async function importModule(rec, absPath) {
  try {
    const mod = await import(pathToFileURL(absPath).href + `?verify=${Date.now()}`)
    rec.module = mod
    rec.importOk = true
  } catch (e) {
    rec.importOk = false
    rec.importError = String(e && e.message ? e.message : e)
    return false
  }

  const mod = rec.module
  const def = mod.default
  rec.hasDefault = 'default' in mod
  rec.defaultType = def === null ? 'null' : Array.isArray(def) ? 'array' : typeof def
  rec.isObject = !!def && typeof def === 'object'
  rec.exportNames = Object.keys(mod)

  if (!rec.hasDefault) {
    error(rec.dir, 'no-default-export', `il modulo non ha un export default (export trovati: ${rec.exportNames.join(', ') || 'nessuno'})`)
    return true
  }
  if (!rec.isObject) {
    error(rec.dir, 'default-not-object', `l'export default è ${rec.defaultType}, non un'istanza oggetto`)
    return true
  }

  const missing = []
  rec.methods = {}
  for (const m of EXPECTED_METHODS) {
    const present = typeof def[m] === 'function'
    rec.methods[m] = present
    if (!present) missing.push(m)
  }
  if (missing.length > 0) {
    // WARNING e non ERROR: un tipo di fonte futuro potrebbe non avere tutti e quattro.
    warn(
      rec.dir,
      'incomplete-export-shape',
      `istanza esportata senza questi metodi: ${missing.join(', ')} (presenti: ${EXPECTED_METHODS.filter((m) => rec.methods[m]).join(', ') || 'nessuno'})`,
      { missing },
    )
  }
  return true
}

// ---------------------------------------------------------------------------
// Strumenti di rete: classificazione di stato e attribuzione della causa
// ---------------------------------------------------------------------------

function classifyStatus(status) {
  if (status >= 200 && status < 300) return { kind: 'ok', verdict: '2xx, risposta utilizzabile' }
  if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308)
    return { kind: 'redirect', verdict: `${status}: redirect non seguito fino in fondo (rotta cambiata?)` }
  if (status === 401 || status === 403)
    return { kind: 'forbidden', verdict: `${status}: accesso negato, muro anti-bot probabile (non è un URL inesistente)` }
  if (status === 404 || status === 410)
    return { kind: 'not-found', verdict: `${status}: percorso inesistente — questo è un URL sbagliato, NON un muro anti-bot` }
  if (status === 429)
    return { kind: 'rate-limited', verdict: '429: rate limit, il sito ha bloccato la richiesta' }
  if (status === 451)
    return { kind: 'blocked', verdict: '451: bloccato per ragioni legali/geografiche' }
  if (status === 503)
    return { kind: 'wall-or-down', verdict: '503: servizio non disponibile, muro anti-bot o sito giù' }
  if (status === 520 || status === 521 || status === 522 || status === 524)
    return {
      kind: 'origin-down',
      verdict: `${status}: Cloudflare non raggiunge l'origine (il sito è giù), NON è un muro anti-bot`,
    }
  if (status >= 500) return { kind: 'upstream-error', verdict: `${status}: errore del server remoto` }
  return { kind: 'http-error', verdict: `${status}: risposta HTTP non riuscita` }
}

function detectWall(body) {
  const hits = []
  for (const s of WALL_SIGNALS) {
    if (s.test.test(body)) hits.push({ id: s.id, label: s.label, weight: s.weight })
  }
  return hits
}

// Dove si è fermato il modulo? I quattro casi distinguibili dal tracciato:
//   0 richieste  -> ramo sbagliato prima della rete
//   non-2xx      -> URL sbagliato o muro
//   2xx + stop   -> regex/selettore obsoleto (o guard che scarta la pagina)
//   risultati    -> funziona
function attributeEmptyResult(requests) {
  if (requests.length === 0) {
    return {
      code: 'no-request',
      verdict:
        'Nessuna richiesta HTTP emessa: il modulo si è fermato prima della rete (input, ramo sbagliato, o eccezione ingoiata dal catch finale).',
    }
  }

  const firstBad = requests.find((r) => r.status !== undefined && !(r.status >= 200 && r.status < 300))
  const lastGood = [...requests].reverse().find((r) => r.status !== undefined && r.status >= 200 && r.status < 300)
  const stoppedAfterBad = firstBad && (!lastGood || requests.indexOf(firstBad) > requests.indexOf(lastGood))

  if (firstBad && stoppedAfterBad) {
    const k = firstBad.statusClass
    const map = {
      'not-found': ['wrong-url', `Prima richiesta ${firstBad.status} su ${firstBad.url}: il percorso non esiste. Il problema è l'URL costruito dal codice, non il muro anti-bot.`],
      'forbidden': ['anti-bot', `Prima richiesta ${firstBad.status} su ${firstBad.url}: il sito ha negato l'accesso (muro anti-bot probabile).`],
      'rate-limited': ['rate-limited', `Prima richiesta ${firstBad.status}: rate limit del sito.`],
      'origin-down': ['origin-down', `Prima richiesta ${firstBad.status} su ${firstBad.url}: il sito è irraggiungibile alla sorgente, il problema non è nel codice di scraping.`],
      'blocked': ['blocked', `Prima richiesta ${firstBad.status}: richiesta bloccata.`],
      'redirect': ['redirect', `Prima richiesta ${firstBad.status}: redirect non risolto.`],
      'wall-or-down': ['wall-or-down', `Prima richiesta ${firstBad.status}: muro anti-bot o sito giù, indistinguibili senza un secondo tentativo.`],
      'upstream-error': ['upstream-error', `Prima richiesta ${firstBad.status}: errore del server remoto.`],
      'http-error': ['http-error', `Prima richiesta ${firstBad.status}: risposta HTTP non riuscita.`],
    }
    const [code, verdict] = map[k.kind] || ['http-error', `Prima richiesta ${firstBad.status}.`]
    return { code, verdict, status: firstBad.status, url: firstBad.url }
  }

  const last = requests[requests.length - 1]
  const weakGuard = last && last.wallHits && last.wallHits.some((h) => h.weight === 'weak')
  if (weakGuard) {
    return {
      code: 'guard-tripped',
      verdict:
        `Le richieste sono tutte 2xx (${requests.length}) e il modulo si è fermato senza emetterne un'altra, ma il corpo della risposta contiene challenge-platform: quasi certamente un guard anti-bot dentro il codice scarta la pagina. Attenzione: quel marker è servito anche su pagine normali, quindi è un sospetto con motivo, non un verdetto.`,
    }
  }
  return {
    code: 'no-match-after-2xx',
    verdict: `Tutte le richieste hanno risposto 2xx (${requests.length}) ma nessuna corrispondenza è stata estratta: regex o selettore obsoleti rispetto all'HTML attuale.`,
  }
}

// ---------------------------------------------------------------------------
// Strumentazione di globalThis.fetch
// ---------------------------------------------------------------------------

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304])

// Avvolge fetch: registra method/url/status/ms/content-type/byte length, legge il
// corpo e restituisce una Response ricostruita con il corpo già in memoria.
// Serve perché il modulo consuma il corpo con res.text()/res.json(): la
// ricostruzione mantiene quel contratto senza consumare due volte lo stream.
function installFetchRecorder(sink, state) {
  globalThis.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input)
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    const entry = { method, url, phase: state.phase }
    sink.push(entry)
    const t0 = Date.now()
    try {
      const res = await realFetch(input, init)
      entry.status = res.status
      entry.ok = res.ok
      entry.statusClass = classifyStatus(res.status)
      entry.contentType = res.headers.get('content-type') ?? ''
      const body = method === 'HEAD' ? '' : await res.text()
      entry.bytes = Buffer.byteLength(body, 'utf8')
      entry.chars = body.length
      entry.wallHits = detectWall(body)
      entry.ms = Date.now() - t0
      if (body.length > 0) {
        entry.fingerprints = {
          links: (body.match(/<a\s/gi) || []).length,
          iframes: (body.match(/<iframe/gi) || []).length,
          m3u8: /\.m3u8/i.test(body),
          jsonBody: /^\s*[{[]/.test(body),
        }
      }
      return new Response(NULL_BODY_STATUS.has(res.status) || method === 'HEAD' ? null : body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    } catch (e) {
      entry.networkError = String(e && e.message ? e.message : e)
      entry.ms = Date.now() - t0
      throw e
    }
  }
}

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} dopo ${ms} ms`)), ms).unref?.()),
  ])

// ---------------------------------------------------------------------------
// CONTRATTO DEL CONSUMATORE REALE
//
// Il worker di Shiru 6.9.0 non ISPEZIONA il ritorno dei metodi di una fonte:
// lo SPALSA. In `_querySource`:
//
//     promises.push(source.single(options))
//     for (const result of await Promise.allSettled(promises)) {
//       if (result.status === 'fulfilled') {
//         results.push(...result.value)      // <- worker.js:150
//
// `movie` e `batch` vanno nello stesso `Promise.allSettled`, quindi lo stesso
// contratto vale per tutti e tre i metodi.
//
// Due conseguenze che questo harness esiste per non confondere:
//
// 1. `{ results, errors }` è il ritorno CORRETTO di `_querySource`/`query`, NON
//    della fonte. È la trappola: la forma giusta al livello sbagliato sembra
//    conforme e spacca solo quando arriva al `push(...result.value)`.
// 2. Il ritorno della fonte non deve essere SOLO un array: deve essere qualcosa
//    che lo spread accetti. Un array è il caso normale; un array può portare
//    con sé `out.errors = [...]` come diagnostica, perché un array tollera
//    proprietà extra.
//
// Per questo il harness SIMULA il consumatore invece di guardare il valore.
// La forma precedente faceva `Array.isArray(out) ? out.length : null`: un
// non-array diventava `null`, rendeva `?` in output e finiva conteggiato come
// "0 risultati", cioè un esito plausibile. È così che due sorgitori rotti hanno
// passato la verifica. Ispezionare non è verificare.
// ---------------------------------------------------------------------------

const CONSUMER_SPREAD_SITE = 'worker.js:150 results.push(...result.value)'

const CONTRACT_RULE = `array reale obbligatorio — il consumatore lo spalza (${CONSUMER_SPREAD_SITE})`

const CONTRACT_ENTRY_POINTS = ['single', 'batch', 'movie']

// I tre verdetti richiesti, più i due casi in cui non c'è un ritorno da
// giudicare (metodo assente, metodo che ha lanciato).
const CONTRACT_OK = 'contract-ok'
const CONTRACT_VIOLATION = 'contract-violation (non-array)'
const CONTRACT_THREW = 'contract-threw'
const CONTRACT_UNKNOWN = 'contract-unknown (il metodo ha lanciato)'
const CONTRACT_ABSENT = 'contract-assente (metodo non esportato)'

const CONTRACT_STATES = [CONTRACT_OK, CONTRACT_VIOLATION, CONTRACT_THREW, CONTRACT_UNKNOWN, CONTRACT_ABSENT]

// Una violazione di contratto: due stati, distinti perché l'uno è "l'app
// crasha" e l'altro è "l'app spalerebbe spazzatura senza accorgersene".
function isContractViolation(state) {
  return state === CONTRACT_VIOLATION || state === CONTRACT_THREW
}

// L'operazione esatta che l'app esegue sul ritorno. Non è una simulazione di
// facciata: se il valore non è spalabile, `push` solleva lo stesso TypeError
// che l'utente dell'app vedrebbe, con lo stesso testo.
function simulateConsumerSpread(value) {
  const results = []
  results.push(...value)
  return results.length
}

// `describe` è pensato per valori JSON e arriva a `object()` per un Set o per
// una classe. In un messaggio di contratto il nome del costruttore è
// esattamente l'informazione che manca ("object()" non dice nulla), quindi qui
// si degrada con menoinformazione di quanto si ha.
function describeReturn(value) {
  const shape = describe(value)
  if (shape !== 'object()' || value === null || typeof value !== 'object') return shape
  const name = value.constructor && value.constructor.name
  return name && name !== 'Object' ? `object(${name})` : shape
}

// Classifica il ritorno di un entry point rispetto al contratto di sopra.
// Lo spread viene eseguito SEMPRE, anche su un valore che è già un array: il
// contratto va eseguito, non dedotto da `Array.isArray`.
function checkConsumerContract(value) {
  const shape = describeReturn(value)
  if (Array.isArray(value)) {
    try {
      return { state: CONTRACT_OK, isArray: true, count: value.length, spreadCount: simulateConsumerSpread(value), thrown: null, shape }
    } catch (e) {
      return { state: CONTRACT_THREW, isArray: true, count: value.length, spreadCount: null, thrown: String(e && e.message ? e.message : e), shape }
    }
  }
  // Non-array: simula comunque, per distinguere i due modi in cui è rotto.
  // Una stringa o un Set sono iterabili: lo spread non lancerebbe, ma
  // `results` riceverebbe caratteri o valori che non sono risultati. Un oggetto
  // piano non è iterabile: l'app crasha.
  try {
    return { state: CONTRACT_VIOLATION, isArray: false, count: null, spreadCount: simulateConsumerSpread(value), thrown: null, shape }
  } catch (e) {
    return { state: CONTRACT_THREW, isArray: false, count: null, spreadCount: null, thrown: String(e && e.message ? e.message : e), shape }
  }
}

// `errors` è una DIAGNOSTICA che viaggia con il ritorno, non il ritorno. Il
// worker non la legge sul valore della fonte, e la sua presenza non è né un
// pass né un fail: si riporta con conteggio e primo messaggio, su riga propria.
// Vale sia per un array con `out.errors` sia per un oggetto `{results, errors}`:
// leggere l'errore è utile in entrambi i casi, anche quando il secondo è rotto.
function readSidecarErrors(value) {
  if (!value || typeof value !== 'object') return null
  const raw = value.errors
  if (raw === undefined || raw === null) return null
  const list = Array.isArray(raw) ? raw : [raw]
  return { count: list.length, first: list.length ? errorMessageOf(list[0]) : null }
}

// Gli errori possono essere stringhe oppure oggetti `{message}`: il worker stesso
// accoda entrambe le forme (`noResults` è un array di `{message}`).
function errorMessageOf(e) {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
  return describe(e)
}

function contractSummary(contract) {
  if (!contract) return null
  const states = {}
  let violations = 0
  for (const m of CONTRACT_ENTRY_POINTS) {
    const c = contract[m]
    if (!c) continue
    states[m] = c.state
    if (isContractViolation(c.state)) violations++
  }
  return { states, violations }
}

// ---------------------------------------------------------------------------
// Esecuzione live di una singola estensione
// ---------------------------------------------------------------------------

async function runLive(rec, resolvedMain, timeoutMs) {
  const live = {
    requests: [],
    phases: [],
    resultCount: null,
    resultIsArray: null,
    validate: null,
    singleMs: null,
    threw: null,
    // verdetto del contratto del consumatore, per entry point. Popolato da
    // simulateConsumerSpread, non da un'ispezione di Array.isArray.
    contract: {},
  }
  rec.live = live
  if (!resolvedMain) return live

  const state = { phase: 'import' }
  installFetchRecorder(live.requests, state)

  try {
    let inst
    try {
      state.phase = 'import'
      const mod = await import(pathToFileURL(resolvedMain).href + `?live=${Date.now()}`)
      inst = mod.default
    } catch (e) {
      live.threw = `import: ${String(e && e.message ? e.message : e)}`
      return live
    }
    if (!inst || typeof inst !== 'object') {
      live.threw = 'nessuna istanza esportata'
      return live
    }

    // validate()
    if (typeof inst.validate === 'function') {
      state.phase = 'validate'
      const t0 = Date.now()
      const mark = live.requests.length
      try {
        const v = await withTimeout(Promise.resolve(inst.validate()), timeoutMs, 'validate()')
        live.validateRequests = live.requests.slice(mark)
        live.validate = { value: v, type: typeof v, ms: Date.now() - t0, requests: live.validateRequests.length }
      } catch (e) {
        live.validateRequests = live.requests.slice(mark)
        live.validate = { error: String(e && e.message ? e.message : e), ms: Date.now() - t0, requests: live.validateRequests.length }
      }
    } else {
      live.validate = { skipped: 'metodo assente' }
    }

    // single() / batch() / movie(): stesso contratto, stessa verifica.
    //
    // Il worker li mette tutti e tre nello stesso `Promise.allSettled`
    // (worker.js:141-143) e spalare ogni valore soddisfatto a worker.js:150,
    // quindi il trattamento è identico: si esegue lo spread vero e si registra
    // come è andata. `single` resta la fase di cui il harness riporta il
    // conteggio e l'attribuzione della causa; `batch`/`movie` condividono lo
    // stesso contratto senza aggiungere verdetti sul numero di risultati, perché
    // un array VUOTO qui è un esito legittimo ("non c'è niente su questo
    // sito"), non una violazione.
    for (const m of CONTRACT_ENTRY_POINTS) {
      if (typeof inst[m] !== 'function') {
        live.contract[m] = { method: m, state: CONTRACT_ABSENT, note: 'metodo assente sull\'istanza esportata' }
        if (m === 'single') live.singleThrew = 'single() assente'
        continue
      }

      state.phase = m
      const t0 = Date.now()
      const mark = live.requests.length
      const entry = { method: m, ms: null, requests: 0, threw: null, state: null }

      let out
      try {
        out = await withTimeout(Promise.resolve(inst[m](SAMPLE_QUERY)), timeoutMs, `${m}()`)
      } catch (e) {
        entry.threw = String(e && e.message ? e.message : e)
      }

      entry.ms = Date.now() - t0
      entry.requests = live.requests.length - mark

      if (entry.threw) {
        // Qui il consumatore NON è rotto: `Promise.allSettled` raccoglie la
        // rejection e la registra come «Source failed to load results». Non è
        // quindi una violazione di contratto, ed è un esito legittimo della
        // misura (il sito era irraggiungibile, o il modulo è andato in timeout).
        entry.state = CONTRACT_UNKNOWN
        entry.sidecarErrors = null
        if (m === 'single') {
          live.singleThrew = entry.threw
          live.singleMs = entry.ms
        } else {
          warn(rec.dir, `${m}-threw`, `${m}() ha lanciato: ${entry.threw}`)
        }
      } else {
        const c = checkConsumerContract(out)
        entry.state = c.state
        entry.isArray = c.isArray
        entry.count = c.count
        entry.spreadCount = c.spreadCount
        entry.thrownBySpread = c.thrown
        entry.returnedShape = c.shape
        entry.sidecarErrors = readSidecarErrors(out)

        if (c.state === CONTRACT_THREW) {
          error(
            rec.dir,
            `${m}-contract-threw`,
            `${m}() ha restituito ${c.shape}, che non è un array: il consumatore reale eseguirebbe ` +
              `\`results.push(...result.value)\` (${CONSUMER_SPREAD_SITE}) e lancerebbe ` +
              `TypeError: ${c.thrown}. È il crash che l'utente dell'app avrebbe, non un problema di scraping.`,
            { consumer: CONSUMER_SPREAD_SITE, thrown: c.thrown, returned: c.shape },
          )
        } else if (c.state === CONTRACT_VIOLATION) {
          error(
            rec.dir,
            `${m}-contract-non-array`,
            `${m}() ha restituito ${c.shape}, che non è un array. Il consumatore reale (${CONSUMER_SPREAD_SITE}) ` +
              `lo spalerebbe senza errori e accoglierebbe ${c.spreadCount} elementi che NON sono risultati: ` +
              `un silenzio con dati sbagliati, peggio di un crash.`,
            { consumer: CONSUMER_SPREAD_SITE, returned: c.shape, spreadCount: c.spreadCount },
          )
        }

        if (m === 'single') {
          // `resultCount` resta `null` se non è un array: è il modo onesto di
          // dire "non ho contato niente perché il valore non è un array". Non
          // viene più sostituito da 0, che era la regressione.
          live.resultCount = c.count
          live.resultIsArray = c.isArray
          live.sample = c.isArray ? out.slice(0, 1) : out
          live.singleMs = entry.ms
          live.singleThrew = null
        }
      }

      live.contract[m] = entry
      live.phases.push(`${m}: ${entry.state}${entry.threw ? ` (${entry.threw})` : ''}`)
      if (m === 'single') live.singleRequests = live.requests.slice(mark)
    }
  } finally {
    restoreFetch()
  }

  // attribuzione della causa sul risultato vuoto
  const singleReqs = live.singleRequests || []
  if (live.resultCount === 0 || (live.resultCount === null && live.singleThrew)) {
    live.attribution = attributeEmptyResult(singleReqs)
  }
  return live
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `verify.mjs — verifica delle estensioni Shiru (solo Node standard library)

Uso:
  node scripts/verify.mjs [--offline | --live] [--ext <dirname>]... [--json]
  node scripts/verify.mjs --help

Modalità:
  --offline   (predefinita) controlli statici sui manifest e sui moduli.
              NESSUNA richiesta di rete: fetch è bloccata durante l'import.
  --live      controlli statici + esecuzione reale di validate() e single()
              con tracciamento di ogni richiesta HTTP emessa.
              Filtro: --ext <dirname> (ripetibile, es. --ext animeworldsearch)

Uscita:
  --json      scrive solo JSON su stdout (il testo umano va su stderr)
  --help      mostra questa guida ed esce con 0

Codici di uscita:
  offline  0 = nessun errore (i warning non falliscono), 2 = errore del tool
  live     0 = ogni estensione ha restituito almeno un risultato
           1 = almeno un'estensione ha restituito [], oppure ha rotto il
                contratto del consumatore
           2 = errore del tool (repository illeggibile, flag sconosciuto)

Contratto del consumatore (--live):
  single/batch/movie devono restituire un ARRAY reale: il worker di Shiru lo
  spalarebbe a worker.js:150 con results.push(...result.value). L'harness non si
  limita a guardare se è un array: esegue lo spread vero e riporta
  contract-ok / contract-violation (non-array) / contract-threw.
  Una diagnostica out.errors può viaggiare con l'array, ma non è il ritorno.

Attenzione: --live effettua richieste reali a siti di streaming di terze parti.
Non eseguirlo da CI.
`

function parseArgs(argv) {
  const opts = { mode: null, ext: [], json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--offline':
        opts.mode = 'offline'
        break
      case '--live':
        opts.mode = 'live'
        break
      case '--json':
        opts.json = true
        break
      case '--help':
      case '-h':
        opts.help = true
        break
      case '--ext': {
        const v = argv[++i]
        if (v === undefined || v.startsWith('--')) {
          return { error: `--ext richiede il nome di una directory come argomento (mancante: ${v === undefined ? 'fine argomenti' : v})` }
        }
        opts.ext.push(v)
        break
      }
      default:
        return { error: `flag sconosciuto: ${a}` }
    }
  }
  return { opts }
}

// ---------------------------------------------------------------------------
// Rendering umano
// ---------------------------------------------------------------------------

// Stampa un blocco di richieste HTTP tracciate (validate o single) tramite `p`.
function renderRequests(reqs, p) {
  reqs.forEach((r, i) => {
    const st =
      r.status === undefined ? `${C.y}errore di rete${C.x}` : `${r.status >= 200 && r.status < 300 ? C.g : C.y}${r.status}${C.x}`
    const total = r.bytes !== undefined ? `${humanBytes(r.bytes)}  ${r.ms ?? '-'} ms` : `${r.ms ?? '-'} ms`
    p(`      ${i + 1}. ${r.method} ${shortenUrl(r.url)}`)
    p(`         ${st}  ${r.contentType || '(nessun content-type)'}  ${total}`)
    if (r.networkError) p(`         ${C.r}${r.networkError}${C.x}`)
    for (const h of r.wallHits || []) {
      const col = h.weight === 'strong' ? C.r : C.y
      p(`         ${col}${h.weight === 'strong' ? 'muro anti-bot' : 'sospetto (debole)'}: ${h.label}${C.x}`)
    }
  })
}

// ---------------------------------------------------------------------------

const C = process.stdout.isTTY || process.env.FORCE_COLOR ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' } : { r: '', y: '', g: '', b: '', d: '', x: '' }

function humanBytes(n) {
  if (n === undefined || n === null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function shortenUrl(u, max = 96) {
  if (u.length <= max) return u
  return `${u.slice(0, max - 1)}…`
}

// Una riga per entry point: che verdetto ha preso il contratto del consumatore,
// com'era fatto il ritorno, e cosa ha prodotto lo spread vero.
// Non stampa mai `?`: un ritorno non conforme ha un nome, ed è un errore.
function renderContractLine(c, p) {
  if (!c) return
  const col = c.state === CONTRACT_OK ? C.g : isContractViolation(c.state) ? C.r : C.y
  const label = c.method.padEnd(6)
  if (c.state === CONTRACT_ABSENT) {
    p(`    ${C.d}contratto${C.x}      ${label} ${C.y}${c.state}${C.x}  ${C.d}${c.note || ''}${C.x}`)
    return
  }
  if (c.state === CONTRACT_UNKNOWN) {
    p(`    ${C.d}contratto${C.x}      ${label} ${C.y}${c.state}${C.x}  ${C.d}nessun ritorno da giudicare: ${c.threw}${C.x}`)
    return
  }
  const spread =
    c.spreadCount === null
      ? `${C.r}TypeError: ${c.thrownBySpread}${C.x}`
      : `${c.spreadCount} element${c.spreadCount === 1 ? 'o' : 'i'}`
  p(`    ${C.d}contratto${C.x}      ${label} ${col}${c.state}${C.x}  ritorno ${c.returnedShape}, spread → ${spread}`)
}

// `out.errors` è diagnostica che viaggia col ritorno: riga separata, con
// conteggio e primo messaggio. La sua presenza non è un verdetto.
function renderSidecarErrors(c, p) {
  const d = c && c.sidecarErrors
  if (!d || !d.count) return
  p(`    ${C.d}diagnostica${C.x}   ${`${c.method}().errors`.padEnd(11)} ${d.count} ${d.count === 1 ? 'voce' : 'voci'}`)
  if (d.first) p(`                  prima: ${C.d}${shortenUrl(d.first, 200)}${C.x}`)
}

function renderHuman(report) {
  const out = []
  const p = (s = '') => out.push(s)

  p(`${C.b}verify.mjs${C.x} — verifica estensioni Shiru`)
  p(`${C.d}repository:${C.x} ${report.repo}`)
  p(`${C.d}modalità:  ${C.x} ${report.mode}${report.mode === 'live' ? `  (query: ${report.spec.queryUsed.join(', ')})` : '  (nessuna richiesta di rete)'}`)
  p('')

  p(`${C.b}── specifica derivata da index.d.ts ──${C.x}`)
  if (report.spec.sourceTypes.declared) {
    p(`  type ammessi        ${report.spec.sourceTypes.values.map((v) => `"${v}"`).join(', ')}`)
  } else {
    p(`  type ammessi        ${C.y}non derivabili${C.x} — ${report.spec.sourceTypes.reason}`)
  }
  if (report.spec.torrentQueryFields) {
    const unknown = report.spec.queryUsed.filter((f) => !report.spec.torrentQueryFields.includes(f))
    p(
      `  campi TorrentQuery  ${report.spec.queryUsed.length} usati, ${report.spec.queryUsed.length - unknown.length} dichiarati nella specifica` +
        (unknown.length ? `${C.y} (non dichiarati: ${unknown.join(', ')})${C.x}` : ''),
    )
  } else {
    p(`  campi TorrentQuery  ${C.y}non derivabili dalla specifica${C.x}`)
  }
  p('')

  p(`${C.b}── estensioni scoperte: ${report.extensions.length} ──${C.x}`)
  for (const e of report.extensions) {
    const v = e.versions || {}
    p(`  ${C.b}${e.dir}${C.x}${e.id ? `  (id ${e.id}, "${e.name}", type ${e.type ?? '-'})` : ''}`)
    p(
      `    versioni        manifest=${v.manifest ?? '-'}  package=${v.package ?? '-'}  root=${v.root ?? '-'}` +
        (e.versionsAligned === false ? `  ${C.y}← index.json e package.json discordi${C.x}` : ''),
    )
    p(
      `    main            ${e.mainResolved ? `${e.mainResolved}  (forma: ${e.mainForm})` : `${C.r}non risolve${C.x}`}`,
    )
    const okMethods = Object.entries(e.methods || {}).filter(([, v2]) => v2).map(([k]) => k)
    p(
      `    moduli          ${e.sourceFiles ? e.sourceFiles.join(', ') : '-'} → ` +
        (e.importOk === undefined ? `${C.y}non importati${C.x}` : e.importOk ? `import ESM ok` : `${C.r}import fallito${C.x}`),
    )
    p(`    export shape    ${okMethods.length ? okMethods.join(', ') : '(nessuno)'}`)

    // In `--offline` i metodi non vengono invocati (niente rete), quindi non c'è
    // un verdetto di contratto da riportare. Si dichiara il CONTRATTO che
    // `--live` simulerà, una riga per entry point: dichiararlo evita che
    // l'assenza di un verdetto si legga come un pass. Non si "stima" nulla dal
    // testo del sorgente — è la stessa ispezione che ha lasciato passare il bug.
    if (!e.live) {
      for (const m of CONTRACT_ENTRY_POINTS) {
        const present = e.methods ? e.methods[m] === true : null
        p(
          `    ${C.d}contratto${C.x}      ${m.padEnd(6)} ${C.d}${CONTRACT_RULE}${C.x}` +
            (present === false ? `  ${C.y}metodo assente${C.x}` : `  ${C.d}(simulato solo in --live)${C.x}`),
        )
      }
    }

    if (e.live) {
      const L = e.live
      p(`    ${C.b}--live--${C.x}`)
      if (L.validate) {
        if (L.validate.skipped) p(`    validate()      ${C.y}${L.validate.skipped}${C.x}`)
        else if (L.validate.error) p(`    validate()      ${C.r}errore: ${L.validate.error}${C.x}`)
        else p(`    validate()      ${L.validate.value === true ? C.g : C.y}${L.validate.value}${C.x} (${L.validate.ms} ms, ${L.validate.requests} richieste)`)
      }
      if (L.singleThrew) p(`    single()        ${C.r}lanciato: ${L.singleThrew}${C.x}`)
      else
        p(
          `    single()        ${L.resultCount > 0 ? C.g : C.r}${L.resultCount === null ? 'non-array (nessun conteggio)' : L.resultCount} risultati${C.x}` +
            (L.singleMs !== null ? ` in ${L.singleMs} ms` : ''),
        )
      // Contratto del consumatore: una riga per entry point. In `--live` c'è il
      // verdetto; in `--offline` i metodi non vengono invocati (niente rete), e
      // la riga dichiara il contratto che verrà simulato invece di far finta di
      // un verdetto.
      for (const m of CONTRACT_ENTRY_POINTS) {
        const c = (L.contract || {})[m]
        if (c) {
          renderContractLine(c, p)
        } else {
          p(
            `    ${C.d}contratto${C.x}      ${m.padEnd(6)} ${C.d}${CONTRACT_RULE}${C.x}  ` +
              `${C.d}(non simulato: --live richiede rete)${C.x}`,
          )
        }
        if (c) renderSidecarErrors(c, p)
      }
      const vreqs = L.validateRequests || []
      if (vreqs.length > 0) {
        p(`    richieste validate() ${vreqs.length}`)
        renderRequests(vreqs, p)
      }
      const reqs = L.requests || []
      p(`    richieste single() ${reqs.length}`)
      renderRequests(reqs, p)
      if (L.attribution) {
        p(`    ${C.b}causa${C.x}         [${L.attribution.code}] ${L.attribution.verdict}`)
      }
      p('')
    }
    p('')
  }

  const counts = { error: countLevel('error'), warn: countLevel('warn'), info: countLevel('info') }
  p(`${C.b}── rilievi ──${C.x}`)
  if (findings.length === 0) {
    p('  nessuno')
  }
  for (const lvl of ['error', 'warn', 'info']) {
    for (const f of findings.filter((x) => x.level === lvl)) {
      const col = lvl === 'error' ? C.r : lvl === 'warn' ? C.y : C.d
      p(`  ${col}${lvl.toUpperCase().padEnd(5)}${C.x} ${C.d}${f.scope}${C.x} ${f.message}`)
    }
  }
  p('')
  p(
    `${C.b}riepilogo${C.x}  ${counts.error} errori, ${counts.warn} warning, ${counts.info} note` +
      (report.summary.contractViolations > 0 ? `, ${report.summary.contractViolations} violazioni di contratto` : '') +
      `  →  exit ${report.exitCode}`,
  )
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const parsedArgs = parseArgs(argv)

  if (parsedArgs.error) {
    process.stderr.write(`verify.mjs: ${parsedArgs.error}\n\n${USAGE}`)
    return 2
  }
  const opts = parsedArgs.opts
  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (opts.mode && argv.includes('--offline') && argv.includes('--live')) {
    process.stderr.write(`verify.mjs: --offline e --live sono mutuamente esclusivi\n\n${USAGE}`)
    return 2
  }
  const mode = opts.mode || 'offline'

  if (!isDir(REPO)) {
    process.stderr.write(`verify.mjs: repository non leggibile: ${REPO}\n`)
    return 2
  }

  // --- specifica -----------------------------------------------------------
  const spec = { sourceTypes: { values: null, declared: false, reason: '' } }
  const specPath = join(REPO, 'index.d.ts')
  if (!isFile(specPath)) {
    error('repo', 'spec-missing', 'index.d.ts manca: i valori legali di `type` non sono derivabili')
    spec.sourceTypes.reason = 'index.d.ts manca'
  } else {
    const specText = readText(specPath)
    spec.sourceTypes = deriveSourceTypes(specText)
    spec.torrentQueryFields = deriveTorrentQueryFields(specText)
    const res = deriveResolutionValues(specText)
    if (res && res.length > 0 && !res.includes(SAMPLE_QUERY.resolution)) {
      warn('verify.mjs', 'query-resolution', `la resolution della query di prova "${SAMPLE_QUERY.resolution}" non è fra i valori della specifica [${res.join(', ')}]`)
    }
  }
  spec.queryUsed = Object.keys(SAMPLE_QUERY)
  spec.queryUndeclared = spec.torrentQueryFields
    ? spec.queryUsed.filter((f) => !spec.torrentQueryFields.includes(f))
    : []

  const rootPkg = readJson(join(REPO, 'package.json'))
  spec.rootVersion = rootPkg.ok && rootPkg.value && typeof rootPkg.value.version === 'string' ? rootPkg.value.version : null

  // --- indice radice + estensioni -----------------------------------------
  const repoMains = checkRootIndex(spec)

  let names = discoverExtensions(REPO)
  if (names.length === 0) {
    error('repo', 'no-extensions', 'nessuna estensione scoperta (nessuna directory con index.json)')
    return emit({ mode, spec, extensions: [], repoMains }, 2, opts)
  }
  if (opts.ext.length > 0) {
    const unknown = opts.ext.filter((e) => !names.includes(e))
    if (unknown.length > 0) {
      error('cli', 'unknown-ext', `--ext non corrisponde a nessuna directory scoperta: ${unknown.join(', ')} (presenti: ${names.join(', ')})`)
      return emit({ mode, spec, extensions: [], repoMains }, 2, opts)
    }
    names = names.filter((n) => opts.ext.includes(n))
  }

  const extensions = []
  for (const dirName of names) {
    const rec = checkExtension(dirName, spec, repoMains)
    rec.importScopeCalls = []
    extensions.push(rec)
  }

  // --- import moduli -------------------------------------------------------
  // Guardia di rete in offline: se un modulo facesse fetch all'import, l'import
  // fallisce e il difetto è riportato. In live il recorder è installato più avanti.
  for (const rec of extensions) {
    installImportGuard(rec)
    const target = rec.resolvedMain || null
    if (target) {
      await importModule(rec, target)
    } else if (rec.mainForm === 'mancante') {
      warn(rec.dir, 'no-module', 'nessun modulo da importare: `main` non risolve')
    }
    restoreFetch()
    if (rec.importScopeCalls.length > 0) {
      error(
        rec.dir,
        'network-at-import',
        `il modulo emette ${rec.importScopeCalls.length} richieste di rete all'importazione (${rec.importScopeCalls.join(', ')}): in --offline la rete è bloccata`,
      )
    }
  }

  // --- live ----------------------------------------------------------------
  if (mode === 'live') {
    const timeoutMs = 30000
    for (const rec of extensions) {
      await runLive(rec, rec.resolvedMain, timeoutMs)
      // i warning/error del live-mode non entrano nell'exit code (che dipende dai risultati)
      info(
        rec.dir,
        'live-done',
        `live: ${rec.live.singleRequests ? rec.live.singleRequests.length : 0} richieste in single(), ` +
          `${rec.live.resultCount ?? 'nessun conteggio (ritorno non-array)'} risultati, ` +
          `contratto: ${CONTRACT_ENTRY_POINTS.map((m) => `${m}=${(rec.live.contract || {})[m]?.state ?? 'non eseguito'}`).join(' ')}`,
      )
    }
  }

  // --- exit code -----------------------------------------------------------
  // offline: gli errori statici falliscono (1), un errore del tool è 2.
  // live:    il codice è governato dai RISULTATI, come da specifica; gli errori
  //          statici restano riportati ma non cambiano l'exit code. Una
  //          VIOLAZIONE DI CONTRATTO fa eccezione: è un errore, non un
  //          risultato, e deve poter fallire da sola anche quando i risultati
  //          non sono la metrica (p.e. il valore non è un array, quindi non c'è
  //          proprio un numero di risultati da guardare).
  let exitCode
  const errors = countLevel('error')
  const contractOffenders = extensions.filter((e) =>
    e.live && Object.values(e.live.contract || {}).some((c) => c && isContractViolation(c.state)),
  )
  if (mode === 'offline') {
    exitCode = errors > 0 ? 1 : 0
  } else {
    if (errors > 0) {
      info('verify.mjs', 'static-errors', `${errors} errore/i statici presenti: in --live l'exit code dipende dai risultati, non dai controlli statici`)
    }
    if (contractOffenders.length > 0) {
      info(
        'verify.mjs',
        'live-contract-violations',
        `${contractOffenders.length} estensione/i con violazione del contratto del consumatore ` +
          `(${contractOffenders.map((e) => e.dir).join(', ')}): exit 1 per questo, indipendentemente dai risultati`,
      )
    }
    const empties = extensions.filter((e) => !e.live || e.live.resultCount === 0 || e.live.resultCount === null)
    exitCode = empties.length > 0 || contractOffenders.length > 0 ? 1 : 0
  }

  return emit(
    {
      mode,
      spec: {
        sourceTypes: spec.sourceTypes,
        torrentQueryFields: spec.torrentQueryFields,
        queryUsed: spec.queryUsed,
        queryUndeclared: spec.queryUndeclared,
        sampleQuery: SAMPLE_QUERY,
      },
      extensions: extensions.map((e) => ({
        dir: e.dir,
        id: e.id,
        name: e.name,
        type: e.type,
        versions: e.versions,
        versionsAligned: e.versionsAligned,
        mainForm: e.mainForm,
        mainResolved: e.resolvedMain ? relative(REPO, e.resolvedMain) : null,
        packageMain: e.packageMain,
        listedInRootIndex: e.listedInRootIndex,
        sourceFiles: e.sourceFiles,
        importOk: e.importOk,
        importError: e.importError,
        importScopeNetworkCalls: e.importScopeCalls.length,
        hasDefault: e.hasDefault,
        defaultType: e.defaultType,
        exportNames: e.exportNames,
        methods: e.methods,
        live: e.live
          ? {
              validate: e.live.validate,
              validateRequests: e.live.validateRequests || [],
              resultCount: e.live.resultCount,
              resultIsArray: e.live.resultIsArray ?? null,
              singleMs: e.live.singleMs,
              singleThrew: e.live.singleThrew,
              // Contratto del consumatore, per entry point. `state` è il verdetto
              // di simulateConsumerSpread(), non un'ispezione di Array.isArray.
              contract: e.live.contract || {},
              contractSummary: contractSummary(e.live.contract),
              requests: e.live.singleRequests || [],
              allRequests: e.live.requests || [],
              attribution: e.live.attribution,
            }
          : null,
      })),
      repoMains,
    },
    exitCode,
    opts,
  )
}

function emit(payload, exitCode, opts) {
  const report = {
    tool: 'verify.mjs',
    generatedAt: new Date().toISOString(),
    repo: REPO,
    node: process.version,
    mode: payload.mode,
    spec: payload.spec,
    repoMains: payload.repoMains,
    extensions: payload.extensions,
    findings,
    summary: {
      extensions: payload.extensions.length,
      errors: countLevel('error'),
      warnings: countLevel('warn'),
      infos: countLevel('info'),
      liveResults:
        payload.mode === 'live'
          ? payload.extensions.map((e) => ({
              dir: e.dir,
              results: e.live ? e.live.resultCount : null,
              resultsIsArray: e.live ? (e.live.resultIsArray ?? null) : null,
              contract: e.live ? contractSummary(e.live.contract) : null,
              cause: e.live && e.live.attribution ? e.live.attribution.code : null,
            }))
          : null,
      // Quante entry point hanno rotto il contratto del consumatore. Va in
      // cima al riepilogo perché è l'unico finding che rende l'exit non-zero
      // anche quando un'estensione ha comunque restituito risultati.
      contractViolations:
        payload.mode === 'live'
          ? payload.extensions.filter(
              (e) =>
                e.live &&
                Object.values(e.live.contract || {}).some((c) => c && isContractViolation(c.state)),
            ).length
          : null,
    },
    exitCode,
  }
  const human = renderHuman(report)
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.stderr.write(`${human}\n`)
  } else {
    process.stdout.write(`${human}\n`)
  }
  return exitCode
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((e) => {
    process.stderr.write(`verify.mjs: errore inatteso del tool: ${e && e.stack ? e.stack : e}\n`)
    process.exitCode = 2
  })