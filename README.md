# Shiru Italian Streaming Extensions

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Shiru Compatible](https://img.shields.io/badge/Shiru-Compatible-green.svg)](https://shiru.app/)

Estensioni per [Shiru](https://shiru.app/) che permettono di cercare e riprodurre anime in streaming italiano da siti popolari.

## 📺 Fonti Disponibili

| Estensione | Sito | Stato | Regione |
|------------|------|-------|---------|
| **AnimeWorld** | [animeworld.ac](https://www.animeworld.ac) | ✅ Attivo | 🇮🇹 IT |
| **AnimeSaturn** | [animesaturn.net](https://www.animesaturn.net) | ✅ Attivo | 🇮🇹 IT |
| **AnimeUnity** | [animeunity.so](https://www.animeunity.so) | ✅ Attivo | 🇮🇹 IT |
| **AnimeUnion** | [animeunion.tv](https://animeunion.tv) | ✅ Attivo | 🇮🇹 IT |

## 🚀 Installazione

### Metodo 1 - Repository Completo (Consigliato)

Apri Shiru e vai nella sezione **Estensioni** (`shiru.app/#/extensions`), quindi aggiungi:

```
gh:Suplic0z05/shiru-italian-streaming
```

### Metodo 2 - Singole Estensioni

Puoi installare singole estensioni usando questi identificativi:

| Estensione | Identificativo |
|------------|---------------|
| AnimeWorld | `gh:Suplic0z05/shiru-italian-streaming/animeworldsearch` |
| AnimeSaturn | `gh:Suplic0z05/shiru-italian-streaming/animesaturnsearch` |
| AnimeUnity | `gh:Suplic0z05/shiru-italian-streaming/animeunitysearch` |
| AnimeUnion | `gh:Suplic0z05/shiru-italian-streaming/animeunionsearch` |

## 📖 Utilizzo

Una volta installate, le estensioni funzionano automaticamente:

1. **Cerca un anime** in Shiru usando il titolo
2. **Seleziona l'episodio** che vuoi guardare
3. Le estensioni **trovano automaticamente** il link streaming dal sito corrispondente
4. **Riproduci** direttamente nell'app

### Come Funzionano

- 🔍 **Ricerca Automatica**: Cercano l'anime sul sito corrispondente usando il titolo
- 🎬 **Selezione Episodio**: Trovano l'episodio specifico richiesto
- 🔗 **Link Diretto**: Restituiscono il link diretto allo stream video
- ✅ **Validazione**: Verificano periodicamente la disponibilità del sito

## ⚙️ Configurazione

Tutte le estensioni sono pre-configurate con:

- **Regione**: Italia (IT)
- **Headers**: User-Agent e referer appropriati
- **Tipo**: Torrent/Streaming source

## 🔧 Risoluzione Problemi

### Le estensioni non funzionano?

1. **Verifica la connessione** ai siti sorgente
2. **Aggiorna le estensioni** dalla sezione Estensioni di Shiru
3. **Controlla i log** di Shiru per eventuali errori

### I siti cambiano struttura

I siti di streaming possono modificare la loro struttura nel tempo. Se un'estensione smette di funzionare:

1. Controlla se ci sono **aggiornamenti** disponibili
2. Segnala il problema su GitHub
3. In attesa di fix, prova le altre estensioni disponibili

### Requisiti

- Shiru app versione recente
- Connessione internet stabile
- Accesso ai siti di streaming italiani (nessun blocco regionale)

## 📁 Struttura del Progetto

```
shiru-italian-streaming/
├── index.json                 # Indice principale delle estensioni
├── package.json               # Configurazione progetto
├── README.md                  # Questa documentazione
├── animeworldsearch/          # Estensione AnimeWorld
│   ├── index.json
│   ├── package.json
│   └── sources/
│       └── animeworld.js
├── animesaturnsearch/         # Estensione AnimeSaturn
│   ├── index.json
│   ├── package.json
│   └── sources/
│       └── animesaturn.js
├── animeunitysearch/          # Estensione AnimeUnity
│   ├── index.json
│   ├── package.json
│   └── sources/
│       └── animeunity.js
└── animeunionsearch/          # Estensione AnimeUnion
    ├── index.json
    ├── package.json
    └── sources/
        └── animeunion.js
```

## 🤝 Contribuire

Contributi sono benvenuti! Per contribuire:

1. Fork del repository
2. Crea un branch per la tua feature (`git checkout -b feature/NuovaFeature`)
3. Commit delle modifiche (`git commit -m 'Aggiungi NuovaFeature'`)
4. Push sul branch (`git push origin feature/NuovaFeature`)
5. Apri una Pull Request

## 📄 Licenza

Questo progetto è distribuito sotto licenza [GPL-3.0](LICENSE).

## ⚠️ Disclaimer

- Questo progetto è fornito **così com'è**, senza garanzie di alcun tipo
- Le estensioni si connettono a siti di terze parti non affiliati con questo progetto
- L'uso delle estensioni è responsabilità dell'utente finale
- Verifica sempre le leggi locali sul copyright nella tua giurisdizione

## 🔗 Link Utili

- [Shiru App](https://shiru.app/)
- [Documentazione Estensioni Shiru](https://shiru.app/#/extensions)
- [Repository GitHub](https://github.com/Suplic0z05/shiru-italian-streaming)

---

**Sviluppato con ❤️ per la community italiana di anime**
