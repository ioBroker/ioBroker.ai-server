# ioBroker.ai-server: Anleitung für den Entwicklungs-Agenten

Diese Datei beschreibt, was in diesem Repository gebaut wird und wie. Lies sie vollständig, bevor du Code schreibst.

## Ziel

`ai-server` ist ein ioBroker-Adapter, der ein lokales Sprachmodell (LLM) bereitstellt. Er startet über `@iobroker/plugin-docker` einen Ollama-Container, verwaltet Modelle (herunterladen, laden, entladen) und bietet Anfragen an das Modell über `sendTo` und über Datenpunkte an.

Andere Adapter (javascript, ai-toolbox, ai-assistant) sollen den Ollama-Endpunkt bzw. den OpenAI-kompatiblen Endpunkt `/v1/chat/completions` direkt nutzen können. `ai-server` ist also in erster Linie Betreiber und Verwalter des Modellservers, nicht der Ort, an dem die eigentliche KI-Logik lebt.

Wenn Docker nicht verfügbar ist oder der Nutzer es so konfiguriert, verbindet sich der Adapter stattdessen mit einer externen Ollama-Instanz per URL.

## Bevor du anfängst

1. Sieh dir die vorhandene Struktur an (vermutlich aus `@iobroker/create-adapter`). Stelle fest, ob das Projekt TypeScript oder JavaScript nutzt. TypeScript ist erwünscht. Falls das Gerüst JavaScript ist, frage, bevor du umstellst.
2. Installiere die Abhängigkeiten und lies danach diese Quellen:
   - `node_modules/@iobroker/plugin-docker/README.md` (Labels, Variablenersetzung, Einschränkungen)
   - `node_modules/@iobroker/adapter-core/README.md`
   - jsonConfig-Dokumentation im Repository `ioBroker/ioBroker.admin` (Ordner `packages/jsonConfig`)
   - Ollama API Dokumentation (docs.ollama.com bzw. `docs/api.md` im Repository `ollama/ollama`)
3. Prüfe in der Doku von plugin-docker und admin, welche Mindestversionen von js-controller und admin nötig sind, und trage sie in `io-package.json` ein. Rate keine Versionsnummern.

## Architektur

```
Admin-Konfiguration (native)
        │
        ▼
plugin-docker ──liest──► docker-compose.yaml ──startet──► Container ollama/ollama
                                                                  │
Adapter (main.ts) ──HTTP (fetch)──► http://127.0.0.1:<port> ◄────┘
        │
        ├── Objekte/Datenpunkte (Status, Modelle, Chat, Metriken)
        └── sendTo-API (chat, pull, load, unload, …)
```

Der Adapterprozess führt selbst **keine** Inferenz aus und startet **keine** Prozesse per `child_process`. Alles, was mit dem Container zu tun hat, macht plugin-docker; der Adapter spricht nur HTTP.

## Dateistruktur (Ziel)

```
src/main.ts                  Adapterklasse, Lebenszyklus, onStateChange, onMessage
src/lib/ollama-client.ts     HTTP-Client für die Ollama-API (fetch, Timeouts, NDJSON)
src/lib/objects.ts           Anlegen und Pflegen der Objekte, ID-Bereinigung
src/lib/queue.ts             Begrenzung paralleler Anfragen
docker-compose.yaml          Container-Definition für plugin-docker
admin/jsonConfig.json        Konfigurationsoberfläche
admin/i18n/<lang>/translations.json
test/                        Unit- und Integrationstests
```

## io-package.json

Wichtige Felder in `common` (übrige Felder aus dem Template übernehmen, keine erfinden):

```json
{
  "name": "ai-server",
  "mode": "daemon",
  "connectionType": "local",
  "dataSource": "poll",
  "messagebox": true,
  "adminUI": { "config": "json" },
  "stopTimeout": 15000,
  "plugins": {
    "docker": {
      "iobDockerComposeFiles": ["docker-compose.yaml"]
    }
  }
}
```

`@iobroker/plugin-docker` wird als Abhängigkeit in `package.json` eingetragen, mindestens Version 1.2.1 (erst ab dieser Version werden `devices` wirklich an den Container übergeben).

Standardwerte in `native`:

```json
{
  "backend": "docker",
  "gpu": "cpu",
  "dockerCpu": true,
  "dockerRocm": false,
  "externalUrl": "",
  "bind": "127.0.0.1",
  "port": 11434,
  "keepAlive": "5m",
  "parallel": 1,
  "maxQueue": 10,
  "requestTimeout": 300,
  "defaultModel": "",
  "autoUpdate": false,
  "stopOnUnload": false
}
```

`instanceObjects` enthält mindestens `info.connection` (boolean, role `indicator.connected`).

## docker-compose.yaml

```yaml
services:
  ollama:
    image: 'ollama/ollama:latest'
    labels:
      - 'iobEnabled=${config.dockerCpu:-false}'
      - 'iobStopOnUnload=${config.stopOnUnload:-false}'
      - 'iobMonitoringEnabled=true'
      - 'iobAutoImageUpdate=${config.autoUpdate:-false}'
    ports:
      - '${config.bind:-127.0.0.1}:${config.port:-11434}:11434'
    environment:
      OLLAMA_KEEP_ALIVE: '${config.keepAlive:-5m}'
      OLLAMA_MAX_LOADED_MODELS: '1'
      OLLAMA_NUM_PARALLEL: '${config.parallel:-1}'
    volumes:
      - models:/root/.ollama
    networks:
      - true
    restart: unless-stopped

  ollama-rocm:
    image: 'ollama/ollama:rocm'
    labels:
      - 'iobEnabled=${config.dockerRocm:-false}'
      - 'iobStopOnUnload=${config.stopOnUnload:-false}'
      - 'iobMonitoringEnabled=true'
      - 'iobAutoImageUpdate=${config.autoUpdate:-false}'
    ports:
      - '${config.bind:-127.0.0.1}:${config.port:-11434}:11434'
    environment:
      OLLAMA_KEEP_ALIVE: '${config.keepAlive:-5m}'
      OLLAMA_MAX_LOADED_MODELS: '1'
      OLLAMA_NUM_PARALLEL: '${config.parallel:-1}'
    devices:
      - '/dev/kfd:/dev/kfd'
      - '/dev/dri:/dev/dri'
    volumes:
      - models:/root/.ollama
    networks:
      - true
    restart: unless-stopped

networks:
  true:
    driver: bridge

volumes:
  models:
```

Regeln, die du einhalten musst:

- `iobEnabled` ist ein Pflicht-Opt-in. Ein Service ohne `iobEnabled=true` wird vom Plugin nicht angefasst.
- Es darf immer höchstens **ein** Ollama-Service aktiv sein (gleicher Port). Deshalb gibt es die abgeleiteten Felder `dockerCpu` und `dockerRocm` (siehe Konfiguration).
- Die Variablenersetzung kennt nur Werte und Defaults (`${config.x:-default}`), keine Ausdrücke. Logik gehört in die Admin-Konfiguration, nicht in die Compose-Datei.
- Das Volume `models` wird **nicht** in `iobBackup` eingetragen. Modelle sind mehrere GB groß und jederzeit neu ladbar.
- `iobStopOnUnload` bleibt standardmäßig `false`, damit ein Adapterneustart das Modell nicht aus dem Speicher wirft. Falls der Nutzer es aktiviert, deckt `stopTimeout: 15000` das Stoppen ab.
- NVIDIA (`gpus: all`, `deploy.resources.reservations.devices`) wird von plugin-docker vermutlich nicht unterstützt. Nicht einbauen, siehe "Nicht im MVP".

## Konfiguration im Admin (jsonConfig)

Tab **Allgemein**:
- `backend`: Auswahl `docker` oder `external`
- `externalUrl`: nur sichtbar bei `external`, z. B. `http://192.168.1.50:11434`
- `defaultModel`, `requestTimeout` (Sekunden), `parallel`, `maxQueue`

Tab **Docker** (nur sichtbar bei `backend === 'docker'`):
- `gpu`: Auswahl `cpu` oder `rocm` (AMD)
- `bind` (Hinweistext: `0.0.0.0` macht den Server im ganzen Netz ohne Passwort erreichbar), `port`, `keepAlive`, `autoUpdate`, `stopOnUnload`
- Docker-Verfügbarkeitsprüfung mit dem `checkDocker`-Control, falls die eingesetzte admin-Version es anbietet

Abgeleitete, versteckte Felder:
- `dockerCpu` = `backend === 'docker' && gpu === 'cpu'`
- `dockerRocm` = `backend === 'docker' && gpu === 'rocm'`

Setze diese über `onChange` mit `alsoDependsOn` und `calculateFunc` in jsonConfig. Prüfe in der jsonConfig-Doku, dass dieser Mechanismus so existiert. Falls nicht, frage nach, statt einen Workaround zu bauen.

Alle Texte in `admin/i18n` in allen Sprachen des Templates pflegen (`npm run translate`, falls vorhanden).

## Objekte und Datenpunkte

| ID | Typ | Rolle | Schreibbar | Bedeutung |
|---|---|---|---|---|
| `info.connection` | boolean | indicator.connected | nein | Ollama antwortet |
| `info.status` | string | text | nein | `starting`, `ready`, `busy`, `error`, `stopped` |
| `info.backendVersion` | string | text | nein | Antwort von `/api/version` |
| `info.lastError` | string | text | nein | letzte Fehlermeldung |
| `models.<id>.name` | string | text | nein | Originalname, z. B. `qwen3:8b` |
| `models.<id>.size` | number | value | nein | Größe in Bytes (`unit: "B"`) |
| `models.<id>.parameterSize` | string | text | nein | z. B. `8B` |
| `models.<id>.quantization` | string | text | nein | z. B. `Q4_K_M` |
| `models.<id>.loaded` | boolean | indicator | nein | aktuell im Speicher |
| `models.<id>.load` | boolean | button | ja | Modell laden |
| `models.<id>.unload` | boolean | button | ja | Modell entladen |
| `control.pull` | string | text | ja | Modellname eintragen startet Download |
| `control.pullProgress` | number | level | nein | 0 bis 100 (`unit: "%"`) |
| `control.refresh` | boolean | button | ja | Modellliste neu lesen |
| `chat.model` | string | text | ja | Modell für Datenpunkt-Chat, leer = `defaultModel` |
| `chat.system` | string | text | ja | Systemprompt |
| `chat.prompt` | string | text | ja | Schreiben mit `ack=false` startet Anfrage |
| `chat.response` | string | text | nein | Antwort |
| `chat.running` | boolean | indicator | nein | Anfrage läuft |
| `metrics.lastDuration` | number | value | nein | Millisekunden |
| `metrics.tokensPerSecond` | number | value | nein | aus `eval_count / eval_duration` |
| `metrics.promptTokens` | number | value | nein | |
| `metrics.completionTokens` | number | value | nein | |

Regeln:
- `<id>` wird aus dem Modellnamen gebildet: Zeichen aus `this.FORBIDDEN_CHARS` sowie `.`, `:` und `/` durch `_` ersetzen. Originalname in `common.name` und im State `name`.
- Modelle, die in Ollama nicht mehr existieren, werden beim Aktualisieren samt Channel gelöscht.
- Werte, die der Adapter schreibt, immer mit `ack: true`. Auf Befehle nur reagieren, wenn `ack === false`.
- Objekte mit `extendObject` bzw. `setObjectNotExists` anlegen, Rollen und `read`/`write` korrekt setzen.

## sendTo-API

Jede Nachricht wird **immer** per Callback beantwortet, auch im Fehlerfall: `{ error: "Text" }` oder `{ result: … }`.

| Befehl | Nachricht | Antwort |
|---|---|---|
| `chat` | `{ model?, messages: [{role, content, images?}], system?, options?, format?, tools? }` | `{ message, model, durationMs, promptTokens, completionTokens }` |
| `generate` | `{ model?, prompt, system?, options?, format? }` | `{ response, model, durationMs, … }` |
| `listModels` | `{}` | `[{ name, size, parameterSize, quantization, loaded }]` |
| `pull` | `{ model }` | sofort `{ started: true }`, Fortschritt über `control.pullProgress` |
| `deleteModel` | `{ model }` | `{ deleted: true }` |
| `loadModel` | `{ model }` | `{ loaded: true }` |
| `unloadModel` | `{ model }` | `{ unloaded: true }` |
| `status` | `{}` | `{ connected, status, version, baseUrl, loadedModels }` |
| `getEndpoint` | `{}` | `{ ollama: baseUrl, openai: baseUrl + "/v1" }` |

`tools` und `format` werden unverändert an Ollama durchgereicht. Der Adapter führt keine Tool-Aufrufe selbst aus.

## Ollama-Client

- Natives `fetch` (Node 20+), keine zusätzliche HTTP-Bibliothek.
- Jede Anfrage mit `AbortController` und Timeout aus `requestTimeout`.
- Chat und Generate mit `stream: false`.
- `pull` mit `stream: true`, Antwort als NDJSON zeilenweise parsen, Fortschritt aus `completed / total` berechnen, höchstens einmal pro Sekunde in den State schreiben.
- Endpunkte: `GET /api/version`, `GET /api/tags`, `GET /api/ps`, `POST /api/pull`, `DELETE /api/delete`, `POST /api/chat`, `POST /api/generate`.
- Laden: `POST /api/generate` mit `{ model, keep_alive: <config.keepAlive> }` ohne Prompt.
- Entladen: `POST /api/generate` mit `{ model, keep_alive: 0 }`.
- Modellnamen vor jeder Anfrage gegen `/^[a-zA-Z0-9._:\/-]+$/` prüfen.

## Lebenszyklus

**onReady**
1. Basis-URL bestimmen: bei `docker` `http://127.0.0.1:<port>`, bei `external` die konfigurierte URL (ohne abschließenden `/`).
2. `info.status = starting`, `info.connection = false`.
3. `/api/version` abfragen, bis eine Antwort kommt. Beim ersten Start lädt Docker das Image, das kann mehrere Minuten dauern: Intervall mit Backoff (2 s bis 30 s), ohne Obergrenze, aber nach 60 s einmal eine verständliche Info-Meldung ins Log schreiben.
4. Danach `info.connection = true`, `info.status = ready`, Modellliste lesen, `subscribeStates` auf die schreibbaren States.
5. Alle 30 s `/api/ps` abfragen, `loaded` aktualisieren und die Verbindung überwachen. Bei Ausfall zurück zu Schritt 3.

**Timer** nur über `this.setTimeout` / `this.setInterval` des Adapters, damit sie beim Entladen automatisch aufgeräumt werden.

**Warteschlange**: höchstens `parallel` gleichzeitige Anfragen an Ollama, weitere warten. Ist die Warteschlange länger als `maxQueue`, sofort mit Fehler antworten. Während Anfragen laufen, `info.status = busy`.

**onUnload**: laufende Anfragen abbrechen, `info.connection = false`, `callback()` in jedem Fall aufrufen (try/finally).

**Docker nicht vorhanden**: Wenn `backend === 'docker'` und Docker nicht nutzbar ist, `info.status = error`, klare Fehlermeldung ins Log mit Hinweis auf die Option `external`. Der Adapter darf dabei nicht abstürzen oder sich in einer Neustartschleife beenden.

## Sicherheit

- Standardbindung `127.0.0.1`. Bei `0.0.0.0` beim Start eine Warnung loggen (Ollama hat keine Authentifizierung).
- Prompts und Antworten nie auf `info` loggen, nur auf `debug` und auf 200 Zeichen gekürzt.
- Kein `child_process`, keine Shell, keine dynamisch zusammengesetzten Docker-Befehle im Adapter.
- `autoUpdate` standardmäßig aus. Das verwendete Image steht in der README.

## Qualität

Vor jedem Commit müssen grün sein:

```bash
npm run build
npm run check    # falls vorhanden
npm run lint
npm test
```

Tests:
- Unit-Tests für ID-Bereinigung, NDJSON-Parser, Fortschrittsberechnung, Warteschlange und den Ollama-Client mit gemocktem `fetch`.
- Paket- und Integrationstests aus `@iobroker/testing`. Der Integrationstest muss auch ohne Docker bestehen: Der Adapter startet, setzt `info.status = error` und stürzt nicht ab.

Manuell testen mit dem dev-server (`npx @iobroker/dev-server setup`, danach `npx @iobroker/dev-server watch`).

Vor einer Veröffentlichung den ioBroker-Repochecker laufen lassen und alle Fehler und Warnungen beheben.

README (Englisch, zusätzlich `docs/de/README.md`):
- Was der Adapter macht und was nicht
- Voraussetzungen: Docker Engine 20.10+, der Benutzer `iobroker` braucht Zugriff auf den Docker-Socket (Gruppe `docker`)
- Speicherbedarf grob nach Modellgröße, Hinweis auf kleine Modelle für Raspberry Pi
- Konfiguration, Datenpunkte, sendTo-Beispiele in JavaScript
- Wie javascript, ai-toolbox oder ai-assistant den Endpunkt nutzen
- Changelog mit `### **WORK IN PROGRESS**`

## Arbeitsweise

Arbeite in diesen Phasen. Nach jeder Phase: Build, Lint und Tests grün, ein Commit mit aussagekräftiger Nachricht, kurze Zusammenfassung an mich, dann warten.

1. **Gerüst**: `io-package.json`, `package.json`, `docker-compose.yaml`, `jsonConfig` mit abgeleiteten Feldern, Übersetzungen. Abnahme: Instanz startet, der Container läuft im CPU-Modus.
2. **Verbindung**: Ollama-Client, Basis-URL, Warten auf Bereitschaft, Überwachung, `info.*`. Abnahme: `info.connection` wird `true`, auch im Modus `external`.
3. **Modelle**: Liste, Pull mit Fortschritt, Laden, Entladen, Löschen, Aufräumen verschwundener Modelle.
4. **Anfragen**: `sendTo` vollständig, Chat über Datenpunkte, Warteschlange, Metriken.
5. **Abschluss**: Tests vervollständigen, README, Übersetzungen, Repochecker.

Regeln:
- Frage, bevor du neue Abhängigkeiten hinzufügst.
- Ändere keine Dateien, die mit der aktuellen Phase nichts zu tun haben.
- Kein `git push`, kein Release, kein `--force` ohne ausdrückliche Freigabe.
- Wenn die Doku einer Bibliothek etwas anders beschreibt als diese Datei, gilt die Doku. Weise mich auf den Widerspruch hin.

## Nicht im MVP

- llama.cpp als zweites Backend
- NVIDIA-GPUs: braucht `DeviceRequests` in plugin-docker, dafür wird separat ein PR an `ioBroker/plugin-docker` gestellt
- Entfernter Docker-Host über `iobDockerApi`
- ioBroker selbst im Docker-Container (Anbindung über das Netzwerk `iobroker`)
- Tool Calling mit Zugriff auf ioBroker-Objekte (MCP)
- Streaming-Antworten, Embeddings
