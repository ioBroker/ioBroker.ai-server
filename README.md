![Logo](admin/ai-server.png)
# ioBroker.ai-server

[![NPM version](https://img.shields.io/npm/v/iobroker.ai-server.svg)](https://www.npmjs.com/package/iobroker.ai-server)
[![Downloads](https://img.shields.io/npm/dm/iobroker.ai-server.svg)](https://www.npmjs.com/package/iobroker.ai-server)
![Number of Installations](https://iobroker.live/badges/ai-server-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/ai-server-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.ai-server.png?downloads=true)](https://nodei.co/npm/iobroker.ai-server/)

**Tests:** ![Test and Release](https://github.com/ioBroker/ioBroker.ai-server/workflows/Test%20and%20Release/badge.svg)

## ai-server adapter for ioBroker

Runs a local large language model (Ollama) via Docker and manages its models

## Models

Ollama starts without any model. Choose the **default model** in the instance settings (tab "General"):
the list shows the downloaded models, marked with ✓, and a few recommended ones with their download size.
Any other name from [ollama.com/library](https://ollama.com/library) can be typed in, e.g. `qwen3:14b`.
If the default model is not downloaded yet, the adapter downloads it when the instance starts.

A model needs about as much free memory as its size, plus 1-2 GB. On a Raspberry Pi, stay with the small ones
(up to about 4B parameters, e.g. `qwen3:1.7b` or `llama3.2:3b`).

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
`chat.model` selects the model (empty = default model) and `chat.system` sets a system prompt; both are read when the
question is written. Every question is answered on its own, without the previous ones.

### Queue and metrics

At most "Parallel requests" requests (`chat`, `generate`, `chat.prompt`) run at the same time, further ones wait.
If more than "Maximum queue length" requests are waiting, a new one fails at once. `info.status` is `busy` while
requests run.

After every answer the adapter writes `metrics.lastDuration` (ms, without the time in the queue),
`metrics.tokensPerSecond`, `metrics.promptTokens` and `metrics.completionTokens`.

Prompts and answers are only logged on level `debug`, shortened to 200 characters.

## Known limitations

### The first start takes several minutes

On the first start, `@iobroker/plugin-docker` downloads the image `ollama/ollama:latest` before the adapter itself starts.
Until the download is finished, the instance is shown as not running. The log shows
`Pulling image ollama/ollama:latest for own container iob_ai_server_0_ollama. This may take some time...`.
On a Raspberry Pi 5 this took about 5 minutes. Later starts are fast, as the image is already there.

### Switching between CPU, ROCm and an external server

Up to `@iobroker/plugin-docker` 1.2.1, the container of the previous choice is not stopped when you change the
backend or the GPU type in the instance settings. It keeps running and keeps the port:

- after switching from CPU to ROCm (or back), the new container cannot publish the port and does not start;
- after switching to an external server, the old Ollama keeps running and uses memory.

Stop the old container once by hand. The names contain the instance number, here for instance 0:

```bash
sudo docker stop iob_ai_server_0_ollama        # CPU container
sudo docker stop iob_ai_server_0_ollama-rocm   # ROCm container
```

The container is only stopped, not deleted. When you switch back, the adapter starts it again.

A fix for plugin-docker is proposed in [ioBroker/plugin-docker#61](https://github.com/ioBroker/plugin-docker/pull/61).
As soon as it is released, this adapter will require that version and the step above is no longer necessary.

## Developer manual
This section is intended for the developer. It can be deleted later.

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

### Getting started

You are almost done, only a few steps left:
1. Create a new repository on GitHub with the name `ioBroker.ai-server`
1. Initialize the current folder as a new git repository:  
    ```bash
    git init -b main
    git add .
    git commit -m "Initial commit"
    ```
1. Link your local repository with the one on GitHub:  
    ```bash
    git remote add origin https://github.com/ioBroker/ioBroker.ai-server
    ```

1. Push all files to the GitHub repo:  
    ```bash
    git push origin main
    ```
1. Add a new secret under https://github.com/ioBroker/ioBroker.ai-server/settings/secrets. It must be named `AUTO_MERGE_TOKEN` and contain a personal access token with push access to the repository, e.g. yours. You can create a new token under https://github.com/settings/tokens.

1. Head over to [src/main.ts](src/main.ts) and start programming!

### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### State Roles
When creating state objects, it is important to use the correct role for the state. The role defines how the state should be interpreted by visualizations and other adapters. For a list of available roles and their meanings, please refer to the [state roles documentation](https://www.iobroker.net/#en/documentation/dev/stateroles.md).

**Important:** Do not invent your own custom role names. If you need a role that is not part of the official list, please contact the ioBroker developer community for guidance and discussion about adding new roles.

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `build` | Compile the TypeScript sources. |
| `watch` | Compile the TypeScript sources and watch for changes. |
| `test:ts` | Executes the tests you defined in `*.test.ts` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on your code (without compiling anything). |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `translate` | Translates texts in your adapter to all required languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations) for more details. |
| `release` | Creates a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage) for more details. |

### Configuring the compilation
The adapter template uses [esbuild](https://esbuild.github.io/) to compile TypeScript and/or React code. You can configure many compilation settings 
either in `tsconfig.json` or by changing options for the build tasks. These options are described in detail in the
[`@iobroker/adapter-dev` documentation](https://github.com/ioBroker/adapter-dev#compile-adapter-files).

### Writing tests
When done right, testing code is invaluable, because it gives you the 
confidence to change your code while knowing exactly if and when 
something breaks. A good read on the topic of test-driven development 
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92. 
Although writing tests before the code might seem strange at first, but it has very 
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form 
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation 
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually with dev-server
Since you set up `dev-server`, you can use it to run, test and debug your adapter.

You may start `dev-server` by calling from your dev directory:
```bash
dev-server watch
```

The ioBroker.admin interface will then be available at http://localhost:8081/

Please refer to the [`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (GermanBluefox) initial release

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