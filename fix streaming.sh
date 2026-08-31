cd ~/shiru-italian-streaming

# 1. Rimuovi i package.json delle sottocartelle (non servono e sono sbagliati)
rm -f animeworldsearch/package.json
rm -f animesaturnsearch/package.json
rm -f animeunitysearch/package.json

# 2. Ricrea index.json per animeworldsearch (senza spazi)
cat > animeworldsearch/index.json << 'EOF'
[
  {
    "id": "animeworld-it",
    "name": "AnimeWorld",
    "version": "0.0.1",
    "main": "sources/animeworld",
    "update": "gh:Suplic0z05/shiru-italian-streaming/animeworldsearch",
    "type": "torrent",
    "speed": "moderate",
    "accuracy": "medium",
    "regions": ["IT"],
    "description": "Fonte di streaming italiana AnimeWorld (animeworld.ac). Supporta ricerca per titolo e episodio.",
    "icon": "https://www.animeworld.ac/favicon.ico"
  }
]
EOF

# 3. Ricrea index.json per animesaturnsearch
cat > animesaturnsearch/index.json << 'EOF'
[
  {
    "id": "animesaturn-it",
    "name": "AnimeSaturn",
    "version": "0.0.1",
    "main": "sources/animesaturn",
    "update": "gh:Suplic0z05/shiru-italian-streaming/animesaturnsearch",
    "type": "torrent",
    "speed": "moderate",
    "accuracy": "medium",
    "regions": ["IT"],
    "description": "Fonte di streaming italiana AnimeSaturn (animesaturn.net). Supporta ricerca per titolo e episodio.",
    "icon": "https://www.animesaturn.net/favicon.ico"
  }
]
EOF

# 4. Ricrea index.json per animeunitysearch
cat > animeunitysearch/index.json << 'EOF'
[
  {
    "id": "animeunity-it",
    "name": "AnimeUnity",
    "version": "0.0.1",
    "main": "sources/animeunity",
    "update": "gh:Suplic0z05/shiru-italian-streaming/animeunitysearch",
    "type": "torrent",
    "speed": "moderate",
    "accuracy": "high",
    "regions": ["IT"],
    "description": "Fonte di streaming italiana AnimeUnity (animeunity.so). Supporta ricerca per titolo e episodio con stream HLS.",
    "icon": "https://www.animeunity.so/favicon.ico"
  }
]
EOF

# 5. Aggiorna il root package.json con GPL-3.0
cat > package.json << 'EOF'
{
  "name": "shiru-italian-streaming",
  "version": "0.0.1",
  "description": "Estensioni Shiru per siti di streaming italiani (AnimeWorld, AnimeSaturn, AnimeUnity)",
  "type": "module",
  "author": "Suplic0z05",
  "license": "GPL-3.0"
}
EOF

# 6. Verifica che i file JSON siano validi
echo "=== Verifica JSON ==="
for f in index.json animeworldsearch/index.json animesaturnsearch/index.json animeunitysearch/index.json package.json; do
  echo -n "Controllo $f: "
  if python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
    echo "✅ VALIDO"
  else
    echo "❌ INVALIDO"
  fi
done

# 7. Commit e push
git add .
git commit -m "Fix: rimossi spazi extra dai JSON, aggiornata licenza a GPL-3.0"
git push
