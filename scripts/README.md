# scripts/verify.mjs — livello di verifica delle estensioni

Verifica i manifest e i moduli di ogni estensione. Solo Node standard library:
nessuna dipendenza, nessun `npm install`. Le directory delle estensioni vengono
scoperte dal filesystem, nessun nome è scritto nel codice.

## Modalità

**`--offline`** (predefinita) — controlli statici, **nessuna richiesta di rete**.
Controlla: `index.json` radice e i `index.json` di ogni estensione (campi
obbligatori, `name` ≤ 16 caratteri, SemVer stretto, `speed`/`accuracy`/`regions`),
i valori ammessi di `type` **derivati a runtime da `index.d.ts`**, che `main`
risolva davvero su un file esistente, la coerenza delle versioni
(`index.json` / `package.json` / `package.json` radice), che ogni `sources/*.js`
sia importabile come modulo ESM e che esponga `validate`, `single`, `batch`,
`movie`. Durante l'importazione `fetch` è sostituita da una guardia: se un
modulo facesse una richiesta all'import, l'import fallirebbe e verrebbe riportato.

**`--live`** — gli stessi controlli, più l'esecuzione reale di `validate()` e
`single()` con una query torrent (`titles`, `episode`, `episodeCount`,
`resolution`, `media`, `anilistId`, `exclusions`). `fetch` viene avvolta e ogni
richiesta viene tracciata: metodo, URL, status, ms, content-type, byte del
corpo. Un risultato vuoto viene attribuito a una causa: nessuna richiesta
emessa, URL sbagliato (404), muro anti-bot (403/429/503), sito giù (5xx),
regex obsoleta, oppure un guard che scarta la pagina. `challenge-platform` è
**sospetto e non verdetto**: quel marker è servito anche su pagine normali.

## Il contratto del consumatore è simulato, non ispezionato

Il loader di Shiru sparge il ritorno della sorgente così (`worker.js:150`):

```js
results.push(...result.value)
```

Per ogni entry point invocata (`single`, `batch`, `movie`) l'harness esegue
esattamente quella operazione invece di guardare il tipo dichiarato:

```js
const acc = []
acc.push(...out)
```

Tre esiti distinti, perché sono tre problemi diversi:

| esito | significato | exit |
|---|---|---|
| `contract-ok` | array reale, si sparge | — |
| `contract-threw` | l'app crasha: `TypeError: Spread syntax requires ...iterable` | **1** |
| `contract-violation (non-array)` | si sparge spazzatura (un `Set` dà elementi non-risultato) | **1** |

`out.errors` viene riportato come **riga diagnostica** a parte (conteggio +
primo messaggio): la sua presenza **non** è né un pass né un fallimento, perché
l'host non la legge mai. Un array vuoto è `contract-ok`: è un no-match legittimo.

> Perché simulare e non ispezionare: la prima versione dell'harness faceva
> `Array.isArray(out) ? out.length : null`. Un ritorno non-array diventava `null`,
> stampato `?` e contato come «0 risultati» — cioè un **pass**. Il test era
> scritto con la stessa assunzione del codice che doveva controllare, quindi
> approvava il bug: due sorgitori su tre crashavano l'app reale e l'harness li
> dichiarava sani. Una violazione del contratto ora forza l'exit 1 indipendentemente
> dal numero di risultati.

## Uso

```sh
node scripts/verify.mjs --offline        # oppure: npm run verify
node scripts/verify.mjs --live           # oppure: npm run verify:live
node scripts/verify.mjs --live --ext animeworldsearch
node scripts/verify.mjs --offline --json > report.json
node scripts/verify.mjs --help
```

`--ext <dirname>` è ripetibile. `--json` scrive solo JSON su stdout e il testo
umano su stderr.

## Codici di uscita

| modalità | codice | significato |
|---|---|---|
| `--offline` | `0` | nessun errore (i warning non falliscono) |
| `--offline` | `1` | almeno un errore statico |
| entrambe | `2` | errore del tool: flag sconosciuto, repository illeggibile |
| `--live` | `0` | ogni estensione ha restituito almeno un risultato |
| `--live` | `1` | almeno un'estensione ha restituito `[]` **o ha violato il contratto** |

In `--live` gli errori statici sono riportati ma non determinano l'exit code:
quel codice dipende dai risultati, così un URL rotto o un sito giù restano
distinguibili da un errore del tool. Una **violazione del contratto** invece
fallisce sempre, anche con risultati presenti: è un difetto del codice, non della
rete.

## Non eseguire `--live` da CI

`--live` effettua richieste reali a siti di streaming di terze parti. Da CI
sarebbe scraping da IP di datacenter: gli IP vengono bloccati o rispondono in
modo instabile, quindi il risultato non significa nulla come segnale di qualità.
La CI esegue solo `--offline` (vedi `.github/workflows/verify.yml`).