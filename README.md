# Shiru Italian Streaming Extensions

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

Estensioni per [Shiru](https://shiru.app/) che risolvono il link di streaming di un
anime italiano su siti italiani.

> ## ⚠️ Leggi prima: Shiru non può riprodurre questi link
>
> Gli scraper in questo repository **funzionano** e sono verificati con richieste
> HTTP reali. Ma restituiscono un **URL video diretto**, e Shiru 6.9.0 ha un solo
> motore di riproduzione: BitTorrent.
>
> Quindi: **installando queste estensioni non vedrai un film in Shiru.** I link
> risolti sono corretti, ma l'app non li apre.
>
> Non è un bug delle estensioni né dei siti, ed è una cosa che **non si può
> sistemare** da qui. La prova è in [Perché Shiru non può funzionare](#perché-shiru-non-può-funzionare).
> Se ti serve guardare davvero, vedi [Cosa fare invece](#cosa-fare-invece).

## 📺 Fonti

| Estensione | Sito | Scraping | Riproduzione in Shiru | Audio |
|---|---|---|---|---|
| **AnimeWorld** | [animeworld.ac](https://www.animeworld.ac) | ✅ verificato | ❌ impossibile | 🇮🇹 **doppiato IT** |
| **AnimeSaturn** | [animesaturn.net](https://www.animesaturn.net) | ✅ verificato | ❌ impossibile | sottotitolato |
| **AnimeUnity** | [animeunity.so](https://www.animeunity.so) | ✅ verificato | ❌ impossibile | sottotitolato |

**Solo AnimeWorld ha il doppiaggio italiano.** Misurato sui nomi file reali: AnimeWorld
restituisce `DragonBallZ_ITA`, `OnePiece_Ep_001_ITA`; AnimeSaturn e AnimeUnity
restituiscono invece `OnePiece_Ep_001_SUB_ITA`. Se cerchi il doppiaggio, AnimeWorld è
la fonte.

AnimeWorld e AnimeSaturn servono inoltre **lo stesso file upstream** (misurato:
`OnePiece_Ep_001_ITA.mp4`, 143.367.053 byte identici) via due CDN diversi:
`sweetpixel.org` e `streampeaker.org`.

AnimeUnion è stato **rimosso**: l'origin risponde `521` (misurato il 2026-10-05, con
l'edge Cloudflare sano), senza redirect e senza dominio successore, e l'ultima
cattura Wayback risale al 2023-12-20. I suoi due extractor erano errati anche
quando il sito era vivo. Ripristino: `git checkout HEAD -- animeunionsearch`.

## 🚀 Installazione

```
gh:Suplic0z05/shiru-italian-streaming
```

Oppure una singola estensione:

| Estensione | Identificativo |
|------------|---------------|
| AnimeWorld | `gh:Suplic0z05/shiru-italian-streaming/animeworldsearch` |
| AnimeSaturn | `gh:Suplic0z05/shiru-italian-streaming/animesaturnsearch` |
| AnimeUnity | `gh:Suplic0z05/shiru-italian-streaming/animeunitysearch` |

Installarle è innocuo: gli scraper sono read-only, non scrivono nulla e non
aggiungono dipendenze. Ma **non aspettarti una riga riproducibile**: è il punto
del verdetto qui sotto, non un dettaglio dell'installazione.

Cosa vede esattamente l'utente nella 6.9.0 **non è misurato qui**: richiede la
GUI, e questo repository non afferma una schermata che nessuno ha osservato.
Quello che è stabilito è il meccanismo, riga per riga, in
[Perché Shiru non può funzionare](#perché-shiru-non-può-funzionare).

## Perché Shiru non può funzionare

Quattro prove indipendenti, tutte da sorgente e binario 6.9.0, non da documentazione:

1. **`type` è una union a un solo membro.** `index.d.ts` dichiara
   `type: 'torrent'`. Non esiste `link`, `http`, `stream` o `iframe`.
2. **Solo `torrent` è dispatchato.** `manager.js:1204` accetta anche `'subtitle'`,
   ma `worker.js:138` filtra su `type === 'torrent'` e l'unico call site
   (`handler.js:71`) passa `'torrent'`.
3. **Il campo `link` è filtrato da una regex che rifiuta `https://`.**
   `common/modules/torrent.js:45` accetta solo `magnet:`, un infohash esadecimale
   di 8-40 caratteri, o un `*.torrent`. Un `https://…/x.mp4` non ne matcha nessuno.
4. **Nel repo di Shiru non esiste un player HTTP.** Zero occorvenze di `m3u8` in
   tutto il codice. L'unica via HTTP è il WatchTogether, che è magnet-typed.

I 4 siti non pubblicano nulla di BitTorrent: zero magnet, zero `.torrent`, zero
infohash. (Le due stringhe esadecimali di 40 caratteri presenti su AnimeWorld sono
token anti-spam di Cloudflare, non infohash: è il tipo di falso positivo che
rende inutile qualsiasi scraper di infohash per induzione.)

Non siamo i soli ad averlo notato: le 10+ estensioni Shiru della comunità sono
torrent index senza eccezioni.

## Cosa fare invece

Gli stessi siti restituiscono **MP4 diretto su HTTP**, senza browser, senza challenge
e senza Referer sull'host finale. Quindi il problema non sono i siti: è la forma
dell'API di Shiru.

Due host che lo supportano nativamente, in ordine di adattamento:

| Host | Perché | Note |
|---|---|---|
| **Stremio addon** | `streams.url` vuole esattamente un URL diretto al video | `notWebReady: false` è legale, quindi si riproduce senza player esterno. Nidificato `anilist:` gratis |
| **Seanime** | Ha un tipo `onlinestream-provider` nato per questo | Flag `dub` di prima classe e header per sorgente. **Zero provider italiani** oggi: nicchia aperta |

Modello di riferimento: [`sherlockholmesb512-source/easystreams`](https://github.com/sherlockholmesb512-source/easystreams)
fa esattamente le tre fonti qui sopra.
⚠️ Non dichiara licenza: da leggere per la tecnica, non da copiare.

## 🧪 Verifica

```bash
node scripts/verify.mjs --offline   # exit 0: manifest, import ESM, export shape
node scripts/verify.mjs --live      # misura i siti e attribuisce la causa del fallimento
```

Solo stdlib Node, nessuna dipendenza. `--live` classifica il motivo
(`wrong-url`, `origin-down`, `guard-tripped`, `soft-404`, …) invece di limitarsi a
segnalare "0 risultati". Dettagli e limiti: [`scripts/README.md`](scripts/README.md).

La CI esegue solo `--offline`: da IP di datacenter i siti rispondono diversamente.

## 📁 Struttura

```
shiru-italian-streaming/
├── index.json                 # catalogo del repository (NON un manifest)
├── index.d.ts                 # copia della specifica ufficiale v6.9.0
├── package.json
├── scripts/verify.mjs         # harness di verifica
├── .github/workflows/         # CI offline
├── animeworldsearch/          # + sources/animeworld.js
├── animesaturnsearch/         # + sources/animesaturn.js
└── animeunitysearch/          # + sources/animeunity.js
```

`AGENTS.md` contiene i vincoli misurati del loader di Shiru. Leggilo prima di
modificare i sorgenti: quasi tutti i bug di questo repository erano il risultato
di un'assunzione non verificata sull'API.

## 📄 Licenza

[ GPL-3.0](LICENSE).

## ⚠️ Disclaimer

- Fornito **così com'è**, senza garanzie
- I siti sono di terze parti e non affiliati
- L'uso è responsabilità dell'utente; verifica il copyright nella tua giurisdizione
- Gli URL risolti sono **a scadenza breve** (`?token=&expires=`): vanno risolti al
  momento della riproduzione, non memorizzati

## 🔗 Link

- [Shiru App](https://shiru.app/)
- [Repository](https://github.com/Suplic0z05/shiru-italian-streaming)