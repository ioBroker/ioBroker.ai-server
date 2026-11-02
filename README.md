![Logo](admin/ai-server.png)
# ioBroker.ai-server

[![NPM version](https://img.shields.io/npm/v/iobroker.ai-server.svg)](https://www.npmjs.com/package/iobroker.ai-server)
[![Downloads](https://img.shields.io/npm/dm/iobroker.ai-server.svg)](https://www.npmjs.com/package/iobroker.ai-server)
![Number of Installations](https://iobroker.live/badges/ai-server-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/ai-server-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.ai-server.png?downloads=true)](https://nodei.co/npm/iobroker.ai-server/)

**Tests:** ![Test and Release](https://github.com/ioBroker/ioBroker.ai-server/workflows/Test%20and%20Release/badge.svg)

## ai-server adapter for ioBroker

Runs a local large language model with [Ollama](https://ollama.com) and manages its models.
The questions to the model stay in your network, no cloud account is needed.

What the adapter does:

- starts Ollama in a Docker container (via `@iobroker/plugin-docker`), or connects to an Ollama server that is already
  running in your network;
- downloads, loads, unloads and deletes models and shows them as objects;
- answers requests to the model via `sendTo` and via states;
- shows the state of the server, the queue and the speed of the last answer.

What it does not do:

- It does not control ioBroker devices by itself and does not execute tool calls of the model. That is the job of
  the adapter or script that sends the request.
- It does not run the model in the adapter process. The model runs in Ollama.
- Ollama has no user management: everyone who can reach its port can use and change it (see "Bind address").

Other adapters (javascript, admin, ai-toolbox, ai-assistant) can use the Ollama endpoint directly, see
[Use by other adapters](#use-by-other-adapters).

## Requirements

- js-controller 7.1.0 or newer, admin 7.7.2 or newer, Node.js 22 or newer.
- For the backend "Docker container":
  - a Linux host (e.g. Raspberry Pi OS, Debian, Ubuntu) with Docker Engine 20.10 or newer;
  - the user `iobroker` needs access to the Docker socket. Add it to the group `docker` and restart ioBroker:
    ```bash
    sudo usermod -aG docker iobroker
    iob restart
    ```
  - Images: `ollama/ollama:latest` for the CPU, `ollama/ollama:rocm` for AMD graphics cards (ROCm).
    The models are stored in the Docker volume `iob_ai_server_0_models` (for instance 0). This volume is not part of
    the ioBroker backup: models are several GB in size and can be downloaded again at any time.
- For the backend "External Ollama server": a running Ollama that can be reached from the ioBroker host. On Windows,
  install [Ollama for Windows](https://ollama.com/download) and use this backend.

### Memory

A model needs about as much free memory (RAM) as its download size, plus 1-2 GB. The list in the instance settings
offers these models:

| Model         | Download size | Free memory needed |
|---------------|---------------|--------------------|
| `qwen3:1.7b`  | 1.4 GB        | about 3 GB         |
| `llama3.2:3b` | 2.0 GB        | about 3-4 GB       |
| `qwen3:4b`    | 2.5 GB        | about 4 GB         |
| `qwen3.5:4b`  | 3.3 GB        | about 5 GB         |
| `qwen3:8b`    | 5.2 GB        | about 7 GB         |
| `qwen3.5:9b`  | 6.6 GB        | about 8 GB         |
| `gemma4:e4b`  | 6.6 GB        | about 8 GB         |
| `gpt-oss:20b` | 13.8 GB       | about 16 GB        |

On a Raspberry Pi, stay with small models (up to about 4B parameters, e.g. `qwen3:1.7b` or `llama3.2:3b`).
Without a graphics card, the answers of larger models take a long time. Even smaller models like `qwen3:0.6b` answer
faster, but their answers are much less reliable.

## Configuration

Tab **General**:

| Setting               | Meaning                                                                                     |
|-----------------------|---------------------------------------------------------------------------------------------|
| Backend               | "Docker container (managed by ioBroker)" or "External Ollama server"                        |
| External server URL   | only for the external server, e.g. `http://192.168.1.50:11434`                              |
| Default model         | used for requests without a model, downloaded at the start if it is missing (see below)     |
| Request timeout       | maximum duration of a request to the model in seconds (default 300)                         |
| Parallel requests     | how many requests are sent to the model at the same time (default 1)                       |
| Maximum queue length  | requests beyond this number of waiting ones fail at once (default 10)                       |

Tab **Docker** (only for the backend "Docker container"):

| Setting                                    | Meaning                                                                       |
|--------------------------------------------|-------------------------------------------------------------------------------|
| Docker status                              | shows whether Docker can be used on the host                                  |
| Hardware                                   | "CPU" or "AMD GPU (ROCm)". ROCm needs `/dev/kfd` and `/dev/dri` on the host   |
| Bind address                               | `127.0.0.1` (default): only this host reaches Ollama. `0.0.0.0`: the whole network reaches it, **without any password**. The adapter writes a warning to the log then |
| Port                                       | port of Ollama on the host (default 11434)                                   |
| Keep model in memory                       | how long a model stays loaded after the last request: `5m`, `1h`, `0` (unload at once) or `-1` (forever) |
| Update the container image automatically   | off by default. If on, a newer `ollama/ollama` image is downloaded at the start of the instance |
| Stop the container when the instance stops | off by default, so a restart of the adapter keeps the model in memory        |

If you change the hardware or switch to the external server, the instance stops the container of the previous choice
when it restarts after saving. The container is only stopped, not deleted: when you switch back, the same container is
started again, together with the downloaded models.

NVIDIA graphics cards are not supported yet.

## Models

Ollama starts without any model. Choose the **default model** in the instance settings (tab "General"):
the list shows the downloaded models, marked with ✓, and a few recommended ones with their download size.
Any other name from [ollama.com/library](https://ollama.com/library) can be typed in, e.g. `qwen3:14b`.
If the default model is not downloaded yet, the adapter downloads it when the instance starts.

Check the free memory first, see [Memory](#memory).

To download more models, write the name into `ai-server.0.control.pull` or use `sendTo` (see below).
The progress is shown in `control.pullProgress` (0-100 %), errors in the log and in `info.lastError`.
Only one download runs at a time.

Every downloaded model gets a channel below `models`, e.g. `models.qwen3_4b` for `qwen3:4b`:

| State           | Meaning                                       |
|-----------------|-----------------------------------------------|
| `name`          | original name, e.g. `qwen3:4b`                |
| `size`          | size on disk in bytes                         |
| `parameterSize` | number of parameters, e.g. `4.0B`             |
| `quantization`  | e.g. `Q4_K_M`                                 |
| `loaded`        | the model is in memory                        |
| `load`          | button: load the model into memory            |
| `unload`        | button: remove the model from memory          |

Ollama loads a model on the first request by itself and unloads it after the time set in "Keep model in memory".
`loaded` is updated every 30 seconds. Models deleted in Ollama disappear from the objects; `control.refresh` reads the
list at once, e.g. after a model was downloaded with the Ollama command line.

### Managing models with `sendTo`

Every command is answered with `{ result }` or `{ error }`.

| Command       | Message                  | Result                                                     |
|---------------|--------------------------|------------------------------------------------------------|
| `listModels`  | `{}`                     | `[{ name, size, parameterSize, quantization, loaded }]`    |
| `pull`        | `{ model: 'qwen3:4b' }`  | `{ started: true }` at once, progress in `control.pullProgress` |
| `deleteModel` | `{ model: 'qwen3:4b' }`  | `{ deleted: true }`                                        |
| `loadModel`   | `{ model: 'qwen3:4b' }`  | `{ loaded: true }`                                         |
| `unloadModel` | `{ model: 'qwen3:4b' }`  | `{ unloaded: true }`                                       |

```js
const answer = await sendToAsync('ai-server.0', 'listModels', {});
if (answer.error) {
    log(answer.error, 'warn');
} else {
    for (const model of answer.result) {
        log(`${model.name}: ${(model.size / 1e9).toFixed(1)} GB${model.loaded ? ', loaded' : ''}`);
    }
}
```

## Requests to the model

### With `sendTo`

| Command       | Message                                                                           | Result                                                                |
|---------------|-----------------------------------------------------------------------------------|-----------------------------------------------------------------------|
| `chat`        | `{ model?, messages: [{ role, content, images? }], system?, options?, format?, tools?, think? }` | `{ message, model, durationMs, promptTokens, completionTokens }` |
| `generate`    | `{ model?, prompt, system?, options?, format?, think? }`                          | `{ response, thinking?, model, durationMs, promptTokens, completionTokens }` |
| `status`      | `{}`                                                                              | `{ connected, status, version, baseUrl, loadedModels }`               |
| `getEndpoint` | `{}`                                                                              | `{ ollama, openai }`, e.g. `http://127.0.0.1:11434` and `…/v1`        |

- Without `model`, the default model of the instance settings is used.
- `system` is put in front of the messages as a system message.
- `options`, `format`, `tools` and `think` are passed to Ollama unchanged, see the
  [Ollama API](https://docs.ollama.com/api/chat). The adapter does not execute tool calls itself:
  `message.tool_calls` is returned to the caller, who sends the result back as a message with the role `tool`.
- Thinking models (e.g. `qwen3`) think before they answer, unless `think: false` is given.
  The thinking is returned separately in `message.thinking`, not in `content`. On a Raspberry Pi 5, a short question
  to `qwen3:0.6b` took 22 s with thinking and 0.4 s without.

```js
const answer = await sendToAsync('ai-server.0', 'chat', {
    system: 'Answer in one sentence.',
    messages: [{ role: 'user', content: 'Why is the sky blue?' }],
    think: false,
});
if (answer.error) {
    log(answer.error, 'warn');
} else {
    log(answer.result.message.content);
}
```

### With states

Write a question into `chat.prompt`; the answer appears in `chat.response`. `chat.running` is `true` meanwhile.
`chat.model` selects the model (empty = default model) and `chat.system` sets a system prompt. Thinking is switched
off, as it takes many times longer; set `chat.think` to `true` to let a thinking model think first (a model that cannot
think then answers with an error). All three are read when the question is written. Every question is answered on its
own, without the previous ones.

### Queue and metrics

At most "Parallel requests" requests (`chat`, `generate`, `chat.prompt`) run at the same time, further ones wait.
If more than "Maximum queue length" requests are waiting, a new one fails at once. `info.status` is `busy` while
requests run.

After every answer the adapter writes `metrics.lastDuration` (ms, without the time in the queue),
`metrics.tokensPerSecond`, `metrics.promptTokens` and `metrics.completionTokens`.

Prompts and answers are only logged on level `debug`, shortened to 200 characters.

## States

| State                      | Meaning                                                                    |
|----------------------------|----------------------------------------------------------------------------|
| `info.connection`          | Ollama answers                                                             |
| `info.status`              | `starting`, `ready`, `busy`, `error` or `stopped`                          |
| `info.backendVersion`      | version of Ollama                                                          |
| `info.lastError`           | last error                                                                 |
| `models.<id>.*`            | downloaded models, see [Models](#models)                                   |
| `control.pull`             | write a model name to download it                                          |
| `control.pullProgress`     | progress of the download in %                                              |
| `control.refresh`          | button: read the list of models again                                      |
| `chat.model`               | model for `chat.prompt`, empty = default model                             |
| `chat.system`              | system prompt for `chat.prompt`                                            |
| `chat.think`               | let a thinking model think before answering (default `false`)              |
| `chat.prompt`              | writing a question starts the request                                      |
| `chat.response`            | answer to the last question                                                |
| `chat.running`             | a question is being answered                                               |
| `metrics.lastDuration`     | duration of the last request in ms                                         |
| `metrics.tokensPerSecond`  | speed of the last answer                                                   |
| `metrics.promptTokens`     | tokens of the last prompt                                                  |
| `metrics.completionTokens` | tokens of the last answer                                                  |

While Ollama is starting, `info.status` is `starting`. On the first start, Docker downloads the image of Ollama first,
which can take several minutes. If Docker cannot be used, `info.status` is `error` and the log says why.

## Use by other adapters

The address of Ollama is returned by `sendTo('ai-server.0', 'getEndpoint', {})`:

- Ollama API: `http://127.0.0.1:11434`
- OpenAI-compatible API: `http://127.0.0.1:11434/v1` (with `/v1/chat/completions` and `/v1/models`)

Ollama needs no API key. Where a key has to be entered, any text works, Ollama ignores it.

`127.0.0.1` only works for adapters on the same host as Ollama. If the other adapter runs on another host (multihost),
set "Bind address" to `0.0.0.0` and use the IP address of the Ollama host, e.g. `http://192.168.1.10:11434/v1`.
Then everyone in the network can use Ollama without a password, so protect the port with a firewall if needed.

Small local models are much slower than cloud models and make more mistakes, especially with tools. Load the model
before the first request (`models.<id>.load`) and keep it in memory ("Keep model in memory", e.g. `1h` or `-1`), so
the first answer does not wait for the model to load.

### admin: system settings, tab "AI"

Since admin 8.3.5, the AI settings can be set up once for all adapters:

- Provider: "Custom (OpenAI-compatible)"
- Base URL: `http://127.0.0.1:11434/v1`
- API key: leave empty
- Model: the name as in Ollama, e.g. `qwen3:4b`. The test button reads the list of models from Ollama.

The assistant of admin sends the ioBroker tools with every request, so choose a model that supports tool calling,
e.g. one of the `qwen3` models (marked with "tools" on [ollama.com/library](https://ollama.com/library)).

### javascript

- javascript 10.4.8 and newer: keep "Credentials type" on "System-wide AI settings" and set up the tab "AI" of admin
  as described above.
- Own settings (also older versions): "Credentials type" = "Manual",
  "Custom API Base URL" = `http://127.0.0.1:11434/v1`, leave "API key (optional)" empty, check with "Test Custom API".
  The model is chosen in the AI chat of the script editor.

Scripts can use the `sendTo` commands of this adapter, see [Requests to the model](#requests-to-the-model).

### ai-toolbox and ai-assistant

Both have a tab "Custom" for an own inference server:

- "URL for Inference Server": `http://127.0.0.1:11434/v1/chat/completions`. Here the complete address is needed,
  including `/chat/completions`.
- API token: any text or empty.
- Enter the models by name in the table, e.g. `qwen3:4b`, save the settings and then choose the model in the tool
  (ai-toolbox) or in the general settings (ai-assistant).

ai-toolbox waits at most 30 seconds for an answer, and this cannot be changed. Keep the model loaded and use a small
one. In ai-assistant, raise "Timeout (in seconds)" (default 30) to 120 or more on a CPU.

## Known limitations

### The first start takes several minutes

On the first start, `@iobroker/plugin-docker` downloads the image `ollama/ollama:latest` before the adapter itself starts.
Until the download is finished, the instance is shown as not running. The log shows
`Pulling image ollama/ollama:latest for own container iob_ai_server_0_ollama. This may take some time...`.
On a Raspberry Pi 5 this took about 5 minutes. Later starts are fast, as the image is already there.

### NVIDIA graphics cards

Not supported yet: `@iobroker/plugin-docker` cannot pass a GPU (`gpus: all`) to the container. Use the CPU, an AMD card
with ROCm, or an Ollama installed directly on the host with the backend "External Ollama server".

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (GermanBluefox) initial release: Ollama in Docker (CPU or AMD ROCm) or an external Ollama server
* (GermanBluefox) models: list, download with progress, load, unload, delete; default model is downloaded at start
* (GermanBluefox) requests via `sendTo` (`chat`, `generate`, `status`, `getEndpoint`) and via the states `chat.*`
* (GermanBluefox) queue for parallel requests, metrics of the last answer

## License
MIT License

Copyright (c) 2026 GermanBluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.