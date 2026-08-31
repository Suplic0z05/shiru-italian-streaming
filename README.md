# Shiru Italian Streaming Extensions

Estensioni per [Shiru](https://shiru.app/) che permettono di cercare e riprodurre anime in streaming italiano da:

- [AnimeWorld](https://www.animeworld.ac)
- [AnimeSaturn](https://www.animesaturn.net)
- [AnimeUnity](https://www.animeunity.so)

## Installazione

1. Apri Shiru e vai nella sezione **Estensioni** (`shiru.app/#/extensions`).
2. Aggiungi questo repository incollando una delle seguenti voci:

   ```
   gh:Suplic0z05/shiru-italian-streaming
   ```

   oppure, per aggiungere singole fonti:

   ```
   gh:Suplic0z05/shiru-italian-streaming/animeworldsearch
   gh:Suplic0z05/shiru-italian-streaming/animesaturnsearch
   gh:Suplic0z05/shiru-italian-streaming/animeunitysearch
   ```

3. Attiva le estensioni desiderate. Dovresti vedere comparire i risultati di streaming quando cerchi un anime.

## Struttura

```
shiru-italian-streaming/
├── index.json                  (manifest principale)
├── package.json
├── LICENSE
├── README.md
├── animeworldsearch/           (estensione AnimeWorld)
│   ├── index.json
│   ├── package.json
│   └── sources/
│       ├── index.d.ts
│       ├── abstract.js
│       └── animeworld.js
├── animesaturnsearch/          (estensione AnimeSaturn)
│   ├── index.json
│   ├── package.json
│   └── sources/
│       ├── index.d.ts
│       ├── abstract.js
│       └── animesaturn.js
└── animeunitysearch/           (estensione AnimeUnity)
    ├── index.json
    ├── package.json
    └── sources/
        ├── index.d.ts
        ├── abstract.js
        └── animeunity.js
```

## Nota

Questo progetto **non ospita né distribuisce contenuti**. Le estensioni si limitano a indicizzare e collegare stream pubblici disponibili online.

## Licenza

[MIT](LICENSE)
