# Shiru Italian Streaming

## Cosa è

Tre estensioni per l'app [Shiru](https://shiru.app/): risolvono il link di streaming
di un anime italiano su un sito specifico. Nessun codice di riproduzione:
l'estensione restituisce un URL.

Ogni estensione è un trio: `index.json` (manifest), `package.json`,
`sources/<sito>.js`.

| Estensione | Sito | `type` | Audio |
|---|---|---|---|
| `animeworldsearch/` | animeworld.ac | `torrent` | **doppiato IT** |
| `animesaturnsearch/` | animesaturn.net | `torrent` | sottotitolato |
| `animeunitysearch/` | animeunity.so | `torrent` | sottotitolato |

Installazione: `gh:Suplic0z05/shiru-italian-streaming` o `.../<estensione>`.

---

## Il verdetto: gli scraper funzionano, Shiru no

Gli scraper sono verificati con HTTP reale: parsing, URL risolti e `206 video/mp4` su
ranged GET misurati sui siti veri, per ognuno dei tre. AnimeUnity è l'unico con una
catena ricostruita **completamente** — 5 hop, One Piece e Naruto ep1 fino a
`ftypisom`, e con una sola risoluzione del homepage+search+`info_api` per batch.

> **Numeri rimossi, 2026-10-05.** Questo file dichiarava «AnimeWorld 59/59
> assertion, AnimeSaturn 42/42». Non li so più sostentare: il tally di
> `verify.mjs` è errori/warning/note, non assertion, e l'unico artefatto di
> misura sopravvissuto era in `/tmp` ed è sparito. Erano il tipo di numero che
> questo file stesso dichiara non attendibile. Se li reintroduci, porta
> l'artefatto che li produce e il comando che lo esegue.

Ma restituiscono un **URL video diretto**, e Shiru 6.9.0 riproduce solo
BitTorrent. Quindi anche da perfetti le estensioni risolvono il link e l'app non
lo apre.

Non è rimediabile da qui. Cinque prove indipendenti, tutte da sorgente/binario:

1. **`type` è union a un membro** (`index.d.ts`): `type: 'torrent'`.
2. **Solo `torrent` è dispatchato**: `manager.js:1204` accetta anche `'subtitle'`,
   ma `worker.js:138` filtra su `type === 'torrent'` e `handler.js:71` passa solo
   quello.
3. **`torrent.js:45` filtra `link` con una regex che rifiuta `https://`**:
   `/(^magnet:)|(^[A-F\d]{8,40}$)|(.*\.torrent$)/i`. Tre alternative, nessuna
   accetta un URL HTTP.
4. **Zero occorrenze di `m3u8` in tutto il repo di Shiru.** Non esiste un player
   HTTP. L'unica via HTTP è WatchTogether, magnet-typed.
5. **`hash` è la chiave di dedup e l'infohash del motore** (`handler.js:174` →
   `TORRENT.scrape`). I 3 siti non pubblicano magnet, `.torrent` né infohash.

Conseguenze non negoziabili:

- `type` **resta `torrent`**. Qualunque altro valore viene rifiutato.
- **Non fabbricare mai `hash`.** Ora è `''` in tutti e 3 i sorgitori. Un hash falso
  è peggio di uno vuoto: produce una riga dall'aspetto plausibile invece di un
  vuoto onesto. I sorgitori originali avevano `aw-1`/`as-1`/`au-1`, e AnimeUnity e
  AnimeUnion condividevano `au-`, ombreggiandosi a vicenda in silenzio.

---

## Contratto reale del loader vs `index.d.ts`

**`index.d.ts` in questo repo è una copia byte-identica della specifica ufficiale
v6.9.0. La specifica ha un difetto rispetto al binario, e su un punto ha ragione
lei dove avevo ragione io. Entrambe le cose sono qui sotto, con la prova.

| Cosa | `index.d.ts` dichiara | Il binario fa | Verdetto |
|---|---|---|---|
| Ritorno di `single`/`batch`/`movie` | `Promise<TorrentResult[]>` | spread come array | **la specifica ha ragione** |
| `validate` | proprietà `Promise<boolean>` | **metodo** `validate()` | difetto della specifica |

- **`single`/`batch`/`movie` devono restituire un ARRAY.** La prova è
  `worker.js:151`, in `_querySource`:
  ```js
  promises.push(source.single(options))   // ciò che ritorna il SORGENTE
  ...
  results.push(...result.value)           // <--SPARSA COME ARRAY
  ```
  Un oggetto non è iterabile → `TypeError: Spread syntax requires ...iterable`.
  La diagnostica si può appendere come proprietà dell'array (`out.errors = [...]`):
  un array tollera proprietà extra, quindi non si perde nulla.
- **`validate` va implementato come metodo.** `index.d.ts:113` scrive
  `validate: Promise<boolean>`, cioè in sintassi di **proprietà**, ma il loader
  chiama `this.source.validate()` **con le parentesi** in 4 punti
  (`worker.js:65`, `:68`, `:70`, `:161`).

  La riga della spec è una **frase imprecisa che descrive il tipo atteso**, non
  un'istruzione: ogni implementazione naturale (`async validate() { … }`) è un
  metodo e funziona. Ma se la si scrive **alla lettera** — una proprietà che
  contiene una Promise — allora `this.source.validate` non è una funzione:
  `TypeError: this.source.validate is not a function`. Le 4 chiamate sono dentro
  il `try` aperto prima di `:63`, quindi l'eccezione finisce nel `catch` di `:74`
  e `loadAndValidate` ritorna `{ stub, error }`: **l'estensione non viene
  caricata** e il messaggio incolpa il tuo codice invece di nominare l'ambiguità
  della spec.

  Quindi: implementa un metodo, e non forkare `index.d.ts` — il fork costerebbe un
  file da tenere allineato per documentare una frase imprecisa che qui è già
  documentata.

### La trappola che ha prodotto questo bug: due piani diversi

`{ results, errors }` **è** il ritorno corretto — ma del **wrapper**
(`_querySource`, `query`), non del sorgente. Le sue annotazioni
(`worker.js:108`, `:117`) e il suo `results.push(...res.results)` (`:124-125`)
operano su `res` = ritorno di un metodo interno, che è un oggetto.

Due righe più in basso, `worker.js:151` opera invece su `result.value` = ritorno del
**sorgente**, e lo sparge come array. Stessa funzione, stesso nome `results`, due
piani diversi.

> **Correzione, 2026-10-05.** Avevo scritto il contratto al contrario in questo
> file, l'avevo imposto così ai 3 riscrittori, e il mio `verify.mjs` lo codificava:
> `Array.isArray(out) ? out.length : null` rendeva un oggetto `null`, stampato `?` e
> contato come zero risultati. Il test era scritto dalla stessa assunzione del
> codice, quindi **approvava il bug**: 2 sorgitori su 3 crashavano l'app reale e
> l'harness li dichiarava sani. Rilevato misurando `push(...out)` sul ritorno reale
> di ognuno, non leggendo il tipo dichiarato. `index.d.ts` diceva
> `Promise<TorrentResult[]>` ed era corretto: non lo si è forkato.

Altri fatti del loader, verificati:

- **`AbstractSource` non viene mai bundlato**: è solo un typedef JSDoc
  (`worker.js:5`), non è nell'asar, nessun `instanceof`. La doc chiede di
  estenderlo, il loader non lo verifica.
- **Un modulo è respinto se, privato dei commenti, non contiene** `class`,
  `function`, `async function` o `=>` (`worker.js:14-17`, `isStubModule`).
- **Il default export è un'ISTANZA, non una classe.** Tutti e tre:
  `export default new class AnimeSaturn {`. E `worker.js:52`/`:54` prende
  `.default` e lo usa **senza `new`** (`source = (await import(...)).default`).
  Quindi un probe che scrive `new (m.default ?? m)()` solleva
  `is not a constructor`: è il **probe** a essere rotto, non l'estensione. Se un
  probe fallisce così, correggi il probe prima di toccare il sorgente.
- **L'unico canale delle diagnostiche verso l'utente è `throw`.** La catena è:
  `worker.js:147-156` costruisce la lista errori **esclusivamente da promise
  rigettate** (`result.status === 'rejected'`); non legge mai la diagnostica di un
  valore restituito. Poi `handler.js:117-118` solleva un `Error` con quei messaggi e
  `handler.js:121-123` li mostra. Ne segue che:
  - un array di risultati con `out.errors` popolato **non mostra nulla** all'utente:
    le diagnostiche sopravvivono solo a test e debug;
  - un array vuoto senza errori fa dire a `worker.js` *"found no results"*.

  Perciò la regola è: **fallimento vero → `throw`; nessun match genuino → array
  vuoto, senza `throw`.** Confondere le due cose fa leggere all'utente "nessun
  risultato" mentre la causa reale era un 401, un token scaduto o un soft-404.
  `throw` è sicuro: l'host chiama ogni entry point dentro `Promise.allSettled`,
  quindi il rifiuto è isolato per entry point e diventa un messaggio, non un crash.
- **Fallimento parziale in `batch`: restituire l'array, non lanciare.** Misurato
  end-to-end attraverso `worker.js` + `handler.js`: con `[4 risultati]` +
  `errors=[1 msg]` l'host **mostra 4 risultati**. Il motivo è la stessa proprietà
  appena descritta: gli `errors` attaccati all'array sono invisibili all'host, non
  finiscono nella lista errori del wrapper, e `handler.js:117` non solleva nulla.
  Ne segue che **l'errore parziale è silenzioso**: l'utente vede 4 episodi buoni su 5
  e non viene a sapere che il quinto è fallito. È il compromesso scelto, perché
  l'alternativa (`throw`) distruggerebbe i 4 risultati già risolti per guadagnare una
  riga di messaggio. Regola: `throw` solo quando **zero** risultati sono sopravvissuti.
  ⚠️ La giustificazione intuitiva «un array con errori perde i risultati» è **falsa**,
  e per un momento l'ho scritta anch'io in questa nota: a perdere i risultati è solo
  il `throw`, non la proprietà `errors`.
- **`validate()` non deve lanciare.** `worker.js:161` lo avvolge in un
  `Promise.race` e aspetta un booleano: su host irraggiungibile va restituito
  `false`.

### `main` senza `.js` — la trappola che induce al contrario

`manager.js:289`: `if (url.startsWith('extension:')) return \`${url}.js\``.

Nel manifest per-estensione `main` **deve restare senza `.js`**
(`sources/animeworld`, non `sources/animeworld.js`), perché il loader lo aggiunge.
Copiare il path da `package.json:main` produce `animeworld.js.js` e rompe
l'installazione. Il `main` divergente è quello in `package.json`, che Shiru non
legge mai. L'harness lo segnala come INFO: è convenzione, non difetto.

> Questo file, in una versione precedente, affermava il **contrario** e stava
> istruendo chi leggeva a fare il cambio. La divergenza vera è in
> `package.json`, non nel manifest.

### `index.json` radice ≠ manifest per-estensione

Il radice è un array di voci con **solo `main`**, senza `id`/`type`/`update`. Per
`manager.js:681` questo lo classifica come **repository source**, non come lista di
estensioni: intenzionale e coerente, non rotto. Ogni manifest per-estensione è
invece valido (`id`, `name`, `version`, `type`, `main`, `update`), verificato da
`validateConfig` (`manager.js:1203`).

---

## Comandi

```bash
node scripts/verify.mjs --offline   # exit 0: manifest, import ESM, export shape
node scripts/verify.mjs --live      # misura i siti, classifica la causa
```

Dichiarati in `package.json` come `verify` e `verify:live`. Solo stdlib Node.
`--live` **non** va in CI: da IP di datacenter i siti rispondono diversamente.

`verify.mjs` scopre le estensioni con `readdirSync` (`:155-160`), quindi non ha una
lista hardcoded: **aggiungere o togliere una directory è sufficiente**, nessuna
modifica al harness. `:477` avvisa `not-listed-root` se una directory scoperta non è
nel `index.json` radice.

`--live` classifica il motivo (`wrong-url`, `origin-down`, `guard-tripped`,
`soft-404`, …) invece di dire solo "0 risultati".

**`node --check` è più debole di quanto sembri**: su Node 26 accetta `export` col
rilevamento modulo, quindi non convalida che il file sia un ESM valido. L'harness
usa `import()` dinamico, che copre sintassi ESM *e* export shape.

---

## Le 3 catene misurate

### AnimeWorld — la più semplice, e l'unica col dub

```
GET  /filter?keyword=<q>                      → 200, risultati in blocchi div film-list
GET  /play/<slug>.<token>                     → 200, <li class="episode"><a …>
GET  /api/episode/info?id=<data-id>           → 200 {"grabber":"https://…/OnePiece_Ep_001_ITA.mp4"}
```

1. `/filter?keyword=`, **non** `/animelist`.
2. Il titolo è in **`data-jtitle`**, non nel primo href. Il primo match posizionale
   restituisce l'anime sbagliato (Naruto → Boruto).
3. Il token episodico è **`data-id`** e va a `/api/episode/info?id=<token>`.
   `data-episode-id` (numerico) restituisce **401**: misurati `id=1749` → 401,
   `id=29921` → 401, `id=cWAhIl` → 200.
4. `grabber` è un MP4 diretto. L'host finale `srv*.sweetpixel.org` risponde **senza
   Referer, senza cookie e senza UA**.

### AnimeSaturn — 4 hop con XOR

```
GET  /filter?key=<q>                          → 200, ancore con class="ac group"
GET  /anime/<slug>                            → 200, episodi in /episode/<slug>/ep-N
GET  /api/watch/<slug>/ep-N                   → 200 {"videoUrl":"https://play.saturncdn.net/embed/7727?token=…"}
GET  {videoUrl}                               → 200, window.__E = {i, k, e}
GET  {host}/embed/<i>/playlist?token=<k>&expires=<e>   [Referer: <videoUrl>]
                                              → 200 {"d":"<base64>"}
base64-decode(d) XOR repeating key k         → URL diretto
```

- **Il `.net` obbligatorio.** `animesaturn.tv` ha la catena TLS rotta
  (`CERTIFICATE_VERIFY_FAILED`).
- **La chiave XOR è l'ASCII del token `k`, non i suoi byte raw.** Confermato da
  entrambi i lati: `0x0c ^ 'd' = 0x68 = 'h'`, keystream `6435323338303962` =
  `"d523809b"`, poi 112/112 byte stampabili.
- **Il payload NON è sempre `.m3u8`.** Solo per i titoli HLS (One Piece, Naruto); il
  resto del catalogo decodifica in **`.mp4` progressivo** con il proprio
  `?token=&expires=`. Validare sul `.m3u8` scartava 4 stream funzionanti su 6.

### AnimeUnity — 4 chiamate, nessun parsing HTML

```
GET  /                                        → 200, <meta name="csrf-token"> + cookie
POST /livesearch  {"title": …}                → 200 {"records":[{id, slug, title, title_it}]}
GET  /info_api/<id>/<num>                     → 200 {episodes:[{id, number, scws_id}]}
GET  /embed-url/<episode.id>                  → 200, JSON *stringa* con URL vixcloud
GET  {vixcloud}                               → 200, /downloadUrl\s*=\s*['"]([^'"]+)['"]/
```

- **`X-CSRF-TOKEN` + cookie di sessione sono entrambi obbligatori**: senza uno dei
  due → **419**. `X-XSRF-TOKEN` invece di `X-CSRF-TOKEN` → **500**.
- **L'indice cerca i titoli ORIGINALI.** `Dimentica il mio nome, Erina` → 0
  risultati; `L'attaccio dei giganti` esiste solo come campo di *output* `title_it`.
  Un titolo localizzato in ingresso dà silenziosamente `[]`.
- **Il segmento finale è l'`id` dell'episodio, non il numero.**
  `/anime/<id>-<slug>/1` → **200 con props `episode` ed `embed_url` VUOTE**: un
  fallimento morbido che qualsiasi `if (!res.ok)` NON rileva.
- **`/it/anime/...` è 404.** Il prefisso corretto è `/anime/`.

---

## Trappole di parsing misurate

- **Il token `data-id` di AnimeWorld non è sempre alfanumerico**: contiene trattini
  (`w0d-gU`, `-F7QiU`, `-jmtR-`). Un `[A-Za-z0-9]+` scartava **98 episodi su 1180**
  di One Piece: perdita invisibile del 8,3%. Usare `[^"]+`.
- **Le pagine di ricerca contengono un secondo blocco `<a href="/play/…">` non
  correlato** (classifica "più visti", `<i class="rank">`). Una keyword priva di
  senso dà lista film vuota ma **48 ancore sidebar** ancora presenti: parsing
  document-wide restituirebbe l'anime sbagliato per una query senza match.
  Va scopingato ai blocchi `film-list`.
- **AnimeWorld risponde 200 alle pagine play inesistenti**, con
  `<title>AnimeWorld - Pagina non trovata</title>`. `!res.ok` non lo rileva: serve
  un `soft-404` esplicito.
- **Il titolo di AnimeWorld è sensibile alla punteggiatura**: `One Piece Film: Red`
  → 2 risultati, `One Piece Film Red` → **0**. Nessun fallback recupera; i titoli
  vanno presi dal sito, non da AniList/Jikan.
- **Il matching del titolo va per tier**: exact → startswith (più corto) →
  slug-exact → contains (più corto). Lo slug deve essere **esatto, non prefisso**:
  il prefisso riammette il falso positivo `Pokemon Movie 20`.
- **I siti sono in italiano e i titoli cercati spesso no.** `Shingeki no Kyojin` non
  ha overlap lessicale con `L'attaccio dei Giganti`; AnimeSaturn lo risolve via
  JSON-LD `alternateName` sulla pagina anime. Serve una seconda chance esplicita.
- **`challenge-platform` non è mai un muro anti-bot**: è `jsd/main.js` di
  Cloudflare, presente **una volta su ogni pagina normale**. Un guard che lo cerca
  fallisce il 100% delle pagine. Con UA vuota i 3 siti rispondono comunque 200 con
  pagina byte-identica. Il marker che discriminate davvero è `SecurityAW` su
  AnimeWorld, che scatta solo se presente.
- **Le 2 stringhe esadecimali di 40 caratteri su AnimeWorld sono token
  anti-spam Cloudflare** (`/cdn-cgi/l/email-protection#…`). Uno scraper di infohash
  li raccolgerebbe come falsi positivi. Conferma: zero infohash reali.
- **Gli URL risolti scadono.** AnimeSaturn e AnimeUnity portano
  `?token=&expires=`; il token vixcloud misurato dura ~60 giorni, il download URL
  molto meno. **Risolvere al momento della riproduzione, mai memorizzare.**

### AnimeWorld e AnimeSaturn servono lo stesso file

Misurato: `OnePiece_Ep_001_ITA.mp4`, **143.367.053 byte identici**, via
`sweetpixel.org` (AnimeWorld) e `streampeaker.org` (AnimeSaturn). Sono due fronti
sullo stesso upstream. AnimeWorld è il più semplice: niente XOR, niente token.

### Solo AnimeWorld è doppiato

Filenames reali: AnimeWorld → `DragonBallZ_ITA`, `OnePiece_Ep_001_ITA`;
AnimeSaturn e AnimeUnity → `OnePiece_Ep_001_SUB_ITA`. Se l'obiettivo è il **dub**,
AnimeWorld è la fonte e gli altri due sono fansub.

---

## Cosa NON toccare

- **I 3 `sources/*.js` sono l'unico codice del repo.** Ogni modifica cambia il
  comportamento per l'utente finale.
- **`type` nei 3 `index.json`**: resta `torrent`.
- **`hash: ''`**: non riempirlo.
- **`LICENSE`** (GPL-3.0): nessuna derivazione di licenza senza chiedere.
- **`index.d.ts`**: lasciarlo byte-identico all'upstream. Le due discrepanze sono
  documentate sopra; forkarlo creereebbe un fork senza consumatori.

## AnimeUnion — rimosso il 2026-10-05

Origin **521** (Cloudflare non raggiunge l'origin) su ogni host e path, 3 tentativi
identici. Edge Cloudflare sano (TLS 1.3 valido, ~70 ms di risposta), quindi è
decommission di origin, non sovraccarico. Nessun redirect e nessun dominio
successore. Ultima cattura Wayback **2023-12-20** (~34 mesi). Entrambi gli extractor
erano errati anche quando il sito era vivo: `/anime?q=` non è mai esistito (0 di
337 URL archiviati) e `/streamLinks:[{…}]/` non ha mai matchato (0 occorrenze).

Ripristino: `git checkout HEAD -- animeunionsearch` + ripristinare la 4ª voce in
`index.json`.

---

## Mappa

| Path | Ruolo |
|---|---|
| `index.json` | catalogo di repository |
| `index.d.ts` | copia byte-identica della spec ufficiale v6.9.0 (1 difetto: `validate`; sul contratto array la specifica ha ragione) |
| `scripts/verify.mjs` | harness offline/live |
| `scripts/README.md` | uso, exit code, perché il live non va in CI |
| `.github/workflows/verify.yml` | CI offline, Node 24 |
| `*/sources/*.js` | l'unico codice del repo |
| `README.md` | tabella fonti, verdetto, installazione |

## Stato git

HEAD `5b866df` "Add AnimeUnion extension with project structure improvements",
su `ai/goose-cleanup`, 0 avanti / 0 indietro da `origin/main`. Il nome del branch
suggerisce un cleanup **non presente**: non darlo per svolto.