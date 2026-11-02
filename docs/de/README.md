![Logo](../../admin/ai-server.png)

# ioBroker.ai-server

Führt ein lokales Sprachmodell mit [Ollama](https://ollama.com) aus und verwaltet seine Modelle.
Die Fragen an das Modell bleiben im eigenen Netz, ein Cloud-Konto ist nicht nötig.

Was der Adapter macht:

- startet Ollama in einem Docker-Container (über `@iobroker/plugin-docker`) oder verbindet sich mit einem Ollama-Server,
  der bereits im Netz läuft;
- lädt Modelle herunter, lädt sie in den Speicher, entlädt und löscht sie und zeigt sie als Objekte an;
- beantwortet Anfragen an das Modell über `sendTo` und über Datenpunkte;
- zeigt den Zustand des Servers, die Warteschlange und die Geschwindigkeit der letzten Antwort.

Was er nicht macht:

- Er steuert keine ioBroker-Geräte selbst und führt keine Tool-Aufrufe des Modells aus. Das ist Aufgabe des Adapters
  oder Skripts, das die Anfrage stellt.
- Das Modell läuft nicht im Adapterprozess, sondern in Ollama.
- Ollama hat keine Benutzerverwaltung: Jeder, der seinen Port erreicht, kann es nutzen und verändern (siehe "Bind-Adresse").

Andere Adapter (javascript, admin, ai-toolbox, ai-assistant) können den Ollama-Endpunkt direkt nutzen, siehe
[Nutzung durch andere Adapter](#nutzung-durch-andere-adapter).

## Voraussetzungen

- js-controller 7.1.0 oder neuer, admin 7.7.2 oder neuer, Node.js 22 oder neuer.
- Für das Backend "Docker-Container":
  - ein Linux-Host (z. B. Raspberry Pi OS, Debian, Ubuntu) mit Docker Engine 20.10 oder neuer;
  - der Benutzer `iobroker` braucht Zugriff auf den Docker-Socket. Ihn zur Gruppe `docker` hinzufügen und ioBroker
    neu starten:
    ```bash
    sudo usermod -aG docker iobroker
    iob restart
    ```
  - Images: `ollama/ollama:latest` für die CPU, `ollama/ollama:rocm` für AMD-Grafikkarten (ROCm).
    Die Modelle liegen im Docker-Volume `iob_ai_server_0_models` (für Instanz 0). Dieses Volume ist nicht Teil des
    ioBroker-Backups: Modelle sind mehrere GB groß und können jederzeit neu heruntergeladen werden.
- Für das Backend "Externer Ollama-Server": ein laufendes Ollama, das vom ioBroker-Host aus erreichbar ist. Unter
  Windows [Ollama für Windows](https://ollama.com/download) installieren und dieses Backend wählen.

### Arbeitsspeicher

Ein Modell braucht etwa so viel freien Arbeitsspeicher (RAM) wie seine Downloadgröße, plus 1-2 GB. Die Liste in den
Instanzeinstellungen bietet diese Modelle an:

| Modell        | Downloadgröße | Freier Speicher nötig |
|---------------|---------------|-----------------------|
| `qwen3:1.7b`  | 1,4 GB        | etwa 3 GB             |
| `llama3.2:3b` | 2,0 GB        | etwa 3-4 GB           |
| `qwen3:4b`    | 2,5 GB        | etwa 4 GB             |
| `qwen3.5:4b`  | 3,3 GB        | etwa 5 GB             |
| `qwen3:8b`    | 5,2 GB        | etwa 7 GB             |
| `qwen3.5:9b`  | 6,6 GB        | etwa 8 GB             |
| `gemma4:e4b`  | 6,6 GB        | etwa 8 GB             |
| `gpt-oss:20b` | 13,8 GB       | etwa 16 GB            |

Auf einem Raspberry Pi bei kleinen Modellen bleiben (bis etwa 4B Parameter, z. B. `qwen3:1.7b` oder `llama3.2:3b`).
Ohne Grafikkarte dauern die Antworten größerer Modelle lange. Noch kleinere Modelle wie `qwen3:0.6b` antworten
schneller, ihre Antworten sind aber deutlich unzuverlässiger.

## Konfiguration

Reiter **Allgemein**:

| Einstellung                      | Bedeutung                                                                              |
|----------------------------------|----------------------------------------------------------------------------------------|
| Backend                          | "Docker-Container (von ioBroker verwaltet)" oder "Externer Ollama-Server"              |
| URL des externen Servers         | nur beim externen Server, z. B. `http://192.168.1.50:11434`                            |
| Standardmodell                   | für Anfragen ohne Modellangabe; fehlt es, wird es beim Start heruntergeladen (siehe unten) |
| Zeitlimit pro Anfrage            | maximale Dauer einer Anfrage an das Modell in Sekunden (Standard 300)                  |
| Parallele Anfragen               | wie viele Anfragen gleichzeitig an das Modell gehen (Standard 1)                       |
| Maximale Länge der Warteschlange | warten mehr Anfragen, schlägt jede weitere sofort fehl (Standard 10)                   |

Reiter **Docker** (nur beim Backend "Docker-Container"):

| Einstellung                                 | Bedeutung                                                                    |
|---------------------------------------------|------------------------------------------------------------------------------|
| Docker-Status                               | zeigt, ob Docker auf dem Host nutzbar ist                                    |
| Hardware                                    | "CPU" oder "AMD-GPU (ROCm)". ROCm braucht `/dev/kfd` und `/dev/dri` auf dem Host |
| Bind-Adresse                                | `127.0.0.1` (Standard): nur dieser Host erreicht Ollama. `0.0.0.0`: das ganze Netz erreicht es, **ohne Passwort**. Der Adapter schreibt dann eine Warnung ins Log |
| Port                                        | Port von Ollama auf dem Host (Standard 11434)                               |
| Modell im Speicher halten                   | wie lange ein Modell nach der letzten Anfrage geladen bleibt: `5m`, `1h`, `0` (sofort entladen) oder `-1` (dauerhaft) |
| Container-Image automatisch aktualisieren   | standardmäßig aus. Wenn an, wird beim Start der Instanz ein neueres Image von `ollama/ollama` geladen |
| Container beim Stoppen der Instanz anhalten | standardmäßig aus, damit ein Neustart des Adapters das Modell im Speicher lässt |

Wird die Hardware geändert oder auf den externen Server umgestellt, stoppt die Instanz beim Neustart nach dem Speichern
den Container der vorherigen Auswahl. Er wird nur gestoppt, nicht gelöscht: Beim Zurückwechseln startet derselbe
Container wieder, mit den bereits heruntergeladenen Modellen.

NVIDIA-Grafikkarten werden noch nicht unterstützt.

## Modelle

Ollama startet ohne Modell. Das **Standardmodell** in den Instanzeinstellungen (Reiter "Allgemein") wählen:
Die Liste zeigt die heruntergeladenen Modelle mit ✓ und einige empfohlene mit ihrer Downloadgröße.
Jeder andere Name aus [ollama.com/library](https://ollama.com/library) kann eingetippt werden, z. B. `qwen3:14b`.
Ist das Standardmodell noch nicht heruntergeladen, lädt der Adapter es beim Start der Instanz herunter.

Vorher den freien Arbeitsspeicher prüfen, siehe [Arbeitsspeicher](#arbeitsspeicher).

Für weitere Modelle den Namen in `ai-server.0.control.pull` schreiben oder `sendTo` nutzen (siehe unten).
Der Fortschritt steht in `control.pullProgress` (0-100 %), Fehler im Log und in `info.lastError`.
Es läuft immer nur ein Download gleichzeitig.

Jedes heruntergeladene Modell bekommt einen Kanal unter `models`, z. B. `models.qwen3_4b` für `qwen3:4b`:

| Datenpunkt      | Bedeutung                                     |
|-----------------|-----------------------------------------------|
| `name`          | Originalname, z. B. `qwen3:4b`                |
| `size`          | Größe auf der Festplatte in Bytes             |
| `parameterSize` | Anzahl der Parameter, z. B. `4.0B`            |
| `quantization`  | z. B. `Q4_K_M`                                |
| `loaded`        | das Modell ist im Speicher                    |
| `load`          | Taster: Modell in den Speicher laden          |
| `unload`        | Taster: Modell aus dem Speicher entfernen     |

Ollama lädt ein Modell bei der ersten Anfrage selbst und entlädt es nach der unter "Modell im Speicher halten"
eingestellten Zeit. `loaded` wird alle 30 Sekunden aktualisiert. In Ollama gelöschte Modelle verschwinden aus den
Objekten; `control.refresh` liest die Liste sofort neu, z. B. nachdem ein Modell über die Ollama-Kommandozeile
heruntergeladen wurde.

### Modelle mit `sendTo` verwalten

Jeder Befehl wird mit `{ result }` oder `{ error }` beantwortet.

| Befehl        | Nachricht                | Ergebnis                                                   |
|---------------|--------------------------|------------------------------------------------------------|
| `listModels`  | `{}`                     | `[{ name, size, parameterSize, quantization, loaded }]`    |
| `pull`        | `{ model: 'qwen3:4b' }`  | sofort `{ started: true }`, Fortschritt in `control.pullProgress` |
| `deleteModel` | `{ model: 'qwen3:4b' }`  | `{ deleted: true }`                                        |
| `loadModel`   | `{ model: 'qwen3:4b' }`  | `{ loaded: true }`                                         |
| `unloadModel` | `{ model: 'qwen3:4b' }`  | `{ unloaded: true }`                                       |

```js
const answer = await sendToAsync('ai-server.0', 'listModels', {});
if (answer.error) {
    log(answer.error, 'warn');
} else {
    for (const model of answer.result) {
        log(`${model.name}: ${(model.size / 1e9).toFixed(1)} GB${model.loaded ? ', geladen' : ''}`);
    }
}
```

## Anfragen an das Modell

### Mit `sendTo`

| Befehl        | Nachricht                                                                         | Ergebnis                                                              |
|---------------|-----------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| `chat`        | `{ model?, messages: [{ role, content, images? }], system?, options?, format?, tools?, think? }` | `{ message, model, durationMs, promptTokens, completionTokens }` |
| `generate`    | `{ model?, prompt, system?, options?, format?, think? }`                          | `{ response, thinking?, model, durationMs, promptTokens, completionTokens }` |
| `status`      | `{}`                                                                              | `{ connected, status, version, baseUrl, loadedModels }`               |
| `getEndpoint` | `{}`                                                                              | `{ ollama, openai }`, z. B. `http://127.0.0.1:11434` und `…/v1`       |

- Ohne `model` wird das Standardmodell aus den Instanzeinstellungen genutzt.
- `system` wird als Systemnachricht vor die Nachrichten gesetzt.
- `options`, `format`, `tools` und `think` werden unverändert an Ollama weitergegeben, siehe
  [Ollama-API](https://docs.ollama.com/api/chat). Der Adapter führt Tool-Aufrufe nicht selbst aus:
  `message.tool_calls` geht an den Aufrufer zurück, der das Ergebnis als Nachricht mit der Rolle `tool` zurückschickt.
- Denkende Modelle (z. B. `qwen3`) denken vor der Antwort nach, außer `think: false` ist angegeben.
  Das Nachdenken kommt getrennt in `message.thinking` zurück, nicht in `content`. Auf einem Raspberry Pi 5 dauerte eine
  kurze Frage an `qwen3:0.6b` mit Nachdenken 22 s, ohne 0,4 s.

```js
const answer = await sendToAsync('ai-server.0', 'chat', {
    system: 'Antworte in einem Satz.',
    messages: [{ role: 'user', content: 'Warum ist der Himmel blau?' }],
    think: false,
});
if (answer.error) {
    log(answer.error, 'warn');
} else {
    log(answer.result.message.content);
}
```

### Mit Datenpunkten

Eine Frage in `chat.prompt` schreiben; die Antwort erscheint in `chat.response`. Währenddessen ist `chat.running`
`true`. `chat.model` wählt das Modell (leer = Standardmodell), `chat.system` setzt einen Systemprompt. Das Nachdenken
ist ausgeschaltet, weil es ein Vielfaches länger dauert; `chat.think` auf `true` setzen, damit ein denkendes Modell
zuerst nachdenkt (ein Modell, das nicht denken kann, antwortet dann mit einem Fehler). Alle drei werden gelesen, wenn
die Frage geschrieben wird. Jede Frage wird für sich beantwortet, ohne die vorherigen.

### Warteschlange und Metriken

Höchstens "Parallele Anfragen" Anfragen (`chat`, `generate`, `chat.prompt`) laufen gleichzeitig, weitere warten.
Warten mehr als "Maximale Länge der Warteschlange" Anfragen, schlägt eine neue sofort fehl. Solange Anfragen laufen,
ist `info.status` gleich `busy`.

Nach jeder Antwort schreibt der Adapter `metrics.lastDuration` (ms, ohne die Zeit in der Warteschlange),
`metrics.tokensPerSecond`, `metrics.promptTokens` und `metrics.completionTokens`.

Prompts und Antworten werden nur auf der Stufe `debug` geloggt, gekürzt auf 200 Zeichen.

## Datenpunkte

| Datenpunkt                 | Bedeutung                                                                  |
|----------------------------|----------------------------------------------------------------------------|
| `info.connection`          | Ollama antwortet                                                           |
| `info.status`              | `starting`, `ready`, `busy`, `error` oder `stopped`                        |
| `info.backendVersion`      | Version von Ollama                                                         |
| `info.lastError`           | letzte Fehlermeldung                                                       |
| `models.<id>.*`            | heruntergeladene Modelle, siehe [Modelle](#modelle)                        |
| `control.pull`             | Modellname eintragen, um es herunterzuladen                                |
| `control.pullProgress`     | Fortschritt des Downloads in %                                             |
| `control.refresh`          | Taster: Modellliste neu lesen                                              |
| `chat.model`               | Modell für `chat.prompt`, leer = Standardmodell                            |
| `chat.system`              | Systemprompt für `chat.prompt`                                             |
| `chat.think`               | denkendes Modell vor der Antwort nachdenken lassen (Standard `false`)      |
| `chat.prompt`              | eine geschriebene Frage startet die Anfrage                                |
| `chat.response`            | Antwort auf die letzte Frage                                               |
| `chat.running`             | eine Frage wird gerade beantwortet                                         |
| `metrics.lastDuration`     | Dauer der letzten Anfrage in ms                                            |
| `metrics.tokensPerSecond`  | Geschwindigkeit der letzten Antwort                                        |
| `metrics.promptTokens`     | Tokens des letzten Prompts                                                 |
| `metrics.completionTokens` | Tokens der letzten Antwort                                                 |

Während Ollama startet, ist `info.status` gleich `starting`. Beim ersten Start lädt Docker zuerst das Image von Ollama
herunter, das kann mehrere Minuten dauern. Ist Docker nicht nutzbar, ist `info.status` gleich `error` und das Log nennt
den Grund.

## Nutzung durch andere Adapter

Die Adresse von Ollama liefert `sendTo('ai-server.0', 'getEndpoint', {})`:

- Ollama-API: `http://127.0.0.1:11434`
- OpenAI-kompatible API: `http://127.0.0.1:11434/v1` (mit `/v1/chat/completions` und `/v1/models`)

Ollama braucht keinen API-Schlüssel. Wo einer eingetragen werden muss, geht jeder beliebige Text, Ollama ignoriert ihn.

`127.0.0.1` funktioniert nur für Adapter auf demselben Host wie Ollama. Läuft der andere Adapter auf einem anderen Host
(Multihost), die "Bind-Adresse" auf `0.0.0.0` stellen und die IP-Adresse des Ollama-Hosts verwenden, z. B.
`http://192.168.1.10:11434/v1`. Dann kann jeder im Netz Ollama ohne Passwort nutzen, den Port also bei Bedarf mit einer
Firewall schützen.

Kleine lokale Modelle sind deutlich langsamer als Cloud-Modelle und machen mehr Fehler, besonders mit Tools. Das Modell
vor der ersten Anfrage laden (`models.<id>.load`) und im Speicher halten ("Modell im Speicher halten", z. B. `1h` oder
`-1`), damit die erste Antwort nicht auf das Laden des Modells wartet.

### admin: System-Einstellungen, Reiter "KI"

Seit admin 8.3.5 lassen sich die KI-Einstellungen einmal für alle Adapter einrichten:

- Anbieter: "Custom (OpenAI-compatible)"
- Basis-URL: `http://127.0.0.1:11434/v1`
- API-Schlüssel: leer lassen
- Modell: der Name wie in Ollama, z. B. `qwen3:4b`. Der Knopf "Testen" liest die Modellliste aus Ollama.

Der Assistent von admin schickt bei jeder Anfrage die ioBroker-Tools mit. Deshalb ein Modell wählen, das Tool-Aufrufe
beherrscht, z. B. eines der `qwen3`-Modelle (auf [ollama.com/library](https://ollama.com/library) mit "tools"
gekennzeichnet).

### javascript

- javascript 10.4.8 und neuer: "Anmeldedaten-Typ" auf "Systemweite KI-Einstellungen" lassen und den Reiter "KI" in
  admin wie oben beschrieben einrichten.
- Eigene Einstellungen (auch ältere Versionen): "Anmeldedaten-Typ" = "Manuell",
  "Eigene API Base-URL" = `http://127.0.0.1:11434/v1`, "API-Schlüssel (optional)" leer lassen, mit "Eigene API testen"
  prüfen. Das Modell wird im KI-Chat des Skript-Editors ausgewählt.

Skripte können die `sendTo`-Befehle dieses Adapters nutzen, siehe [Anfragen an das Modell](#anfragen-an-das-modell).

### ai-toolbox und ai-assistant

Beide haben einen Reiter "Custom" für einen eigenen Inferenz-Server:

- "URL für Inferenz-Server": `http://127.0.0.1:11434/v1/chat/completions`. Hier wird die vollständige Adresse
  gebraucht, einschließlich `/chat/completions`.
- API-Token: beliebiger Text oder leer.
- Die Modelle per Namen in die Tabelle eintragen, z. B. `qwen3:4b`, die Einstellungen speichern und danach das Modell
  im Tool (ai-toolbox) bzw. in den allgemeinen Einstellungen (ai-assistant) auswählen.

ai-toolbox wartet höchstens 30 Sekunden auf eine Antwort, das lässt sich nicht ändern. Das Modell geladen halten und ein
kleines wählen. In ai-assistant die "Zeitüberschreitung (in Sekunden)" (Standard 30) auf einer CPU auf 120 oder mehr
erhöhen.

## Bekannte Einschränkungen

### Der erste Start dauert mehrere Minuten

Beim ersten Start lädt `@iobroker/plugin-docker` das Image `ollama/ollama:latest` herunter, bevor der Adapter selbst
startet. Bis der Download fertig ist, wird die Instanz als nicht laufend angezeigt. Im Log steht
`Pulling image ollama/ollama:latest for own container iob_ai_server_0_ollama. This may take some time...`.
Auf einem Raspberry Pi 5 dauerte das etwa 5 Minuten. Spätere Starts sind schnell, weil das Image schon da ist.

### NVIDIA-Grafikkarten

Noch nicht unterstützt: `@iobroker/plugin-docker` kann keine GPU (`gpus: all`) an den Container übergeben. Stattdessen
die CPU, eine AMD-Karte mit ROCm oder ein direkt auf dem Host installiertes Ollama mit dem Backend "Externer
Ollama-Server" verwenden.

## Änderungen

Siehe [Changelog](../../README.md#changelog) im englischen README.
