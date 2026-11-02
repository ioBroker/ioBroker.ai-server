"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var utils = __toESM(require("@iobroker/adapter-core"));
var import_models = require("./lib/models");
var import_objects = require("./lib/objects");
var import_ollama_client = require("./lib/ollama-client");
var _client, _connected, _unloading, _retryTimer, _monitorTimer, _monitorRunning, _subscribed, _models, _refreshQueue, _pulling, _AiServer_instances, handleCommand_fn, getBaseUrl_fn, checkDocker_fn, waitForOllama_fn, onConnected_fn, monitor_fn, onDisconnected_fn, stopMonitor_fn, requireClient_fn, refreshModels_fn, syncModels_fn, updateLoaded_fn, setLoaded_fn, ensureDefaultModel_fn, startPull_fn, pull_fn, setStatus_fn, setError_fn, reportError_fn;
const RETRY_MIN_MS = 2e3;
const RETRY_MAX_MS = 3e4;
const WAIT_INFO_AFTER_MS = 6e4;
const MONITOR_INTERVAL_MS = 3e4;
const PROBE_TIMEOUT_MS = 5e3;
const PULL_PROGRESS_INTERVAL_MS = 1e3;
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function getModel(message) {
  const model = message && typeof message === "object" ? message.model : void 0;
  if (typeof model !== "string" || !model.trim()) {
    throw new Error('The message has to name the model, e.g. { model: "qwen3:4b" }');
  }
  return model.trim();
}
class AiServer extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "ai-server"
    });
    __privateAdd(this, _AiServer_instances);
    __privateAdd(this, _client, null);
    __privateAdd(this, _connected, false);
    __privateAdd(this, _unloading, false);
    __privateAdd(this, _retryTimer);
    __privateAdd(this, _monitorTimer);
    __privateAdd(this, _monitorRunning, false);
    __privateAdd(this, _subscribed, false);
    /** Names of the models by object ID, as of the last refresh */
    __privateAdd(this, _models, /* @__PURE__ */ new Map());
    /** Refreshes run one after another, so that two of them do not create and delete the same objects */
    __privateAdd(this, _refreshQueue, Promise.resolve());
    /** The model being downloaded. Only one download runs at a time, as there is one progress state */
    __privateAdd(this, _pulling, null);
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   * The container itself is started by plugin-docker (see docker-compose.yaml), not by the adapter.
   * The plugin is initialized before this method is called, so a missing image is already pulled.
   */
  async onReady() {
    await this.setState("info.connection", false, true);
    await __privateMethod(this, _AiServer_instances, setStatus_fn).call(this, "starting");
    const baseUrl = __privateMethod(this, _AiServer_instances, getBaseUrl_fn).call(this);
    if (!baseUrl) {
      await __privateMethod(this, _AiServer_instances, setError_fn).call(this, `Invalid URL of the external Ollama server: "${this.config.externalUrl}". Expected e.g. http://192.168.1.50:11434`);
      return;
    }
    if (this.config.backend === "docker") {
      if (this.config.bind === "0.0.0.0") {
        this.log.warn(
          `Ollama is reachable on port ${this.config.port} from the whole network. Ollama has no authentication: everyone in the network can use and change it.`
        );
      }
      const dockerError = await __privateMethod(this, _AiServer_instances, checkDocker_fn).call(this);
      if (dockerError) {
        await __privateMethod(this, _AiServer_instances, setError_fn).call(this, dockerError);
        return;
      }
    }
    __privateSet(this, _client, new import_ollama_client.OllamaClient({
      baseUrl,
      timeoutMs: (Number(this.config.requestTimeout) || 300) * 1e3,
      timers: {
        setTimeout: (callback, ms) => this.setTimeout(callback, ms),
        clearTimeout: (handle) => this.clearTimeout(handle)
      }
    }));
    this.log.info(`Waiting for Ollama at ${baseUrl}`);
    __privateMethod(this, _AiServer_instances, waitForOllama_fn).call(this);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  async onUnload(callback) {
    var _a;
    try {
      __privateSet(this, _unloading, true);
      (_a = __privateGet(this, _client)) == null ? void 0 : _a.abortAll();
      __privateMethod(this, _AiServer_instances, stopMonitor_fn).call(this);
      this.clearTimeout(__privateGet(this, _retryTimer));
      await this.setState("info.connection", false, true);
      await __privateMethod(this, _AiServer_instances, setStatus_fn).call(this, "stopped");
    } catch (error) {
      this.log.error(`Error during unloading: ${errorText(error)}`);
    } finally {
      callback();
    }
  }
  /**
   * Commands written into the states: `control.pull`, `control.refresh` and the buttons of the models
   *
   * @param id full state ID
   * @param state the new state, only commands (`ack: false`) are handled
   */
  async onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    const localId = id.substring(this.namespace.length + 1);
    try {
      if (localId === "control.pull") {
        const model = typeof state.val === "string" ? state.val.trim() : "";
        if (model) {
          __privateMethod(this, _AiServer_instances, startPull_fn).call(this, model);
        } else {
          await this.setState(localId, "", true);
        }
      } else if (localId === "control.refresh") {
        await this.setState(localId, state.val, true);
        await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this);
      } else {
        const command = (0, import_objects.parseModelCommand)(localId);
        if (!command || !state.val) {
          return;
        }
        await this.setState(localId, state.val, true);
        const model = __privateGet(this, _models).get(command.id);
        if (!model) {
          throw new Error("Ollama does not have this model any more");
        }
        await __privateMethod(this, _AiServer_instances, setLoaded_fn).call(this, model, command.command === "load");
      }
    } catch (error) {
      await __privateMethod(this, _AiServer_instances, reportError_fn).call(this, `${localId}: ${errorText(error)}`);
    }
  }
  /**
   * The sendTo API. Every message with a callback is answered, with `{ result }` or `{ error }`
   *
   * @param obj the message
   */
  async onMessage(obj) {
    if (!(obj == null ? void 0 : obj.command)) {
      return;
    }
    let answer;
    if (obj.command === "getModelOptions") {
      answer = (0, import_models.modelOptions)(await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this).catch(() => []));
    } else {
      try {
        answer = { result: await __privateMethod(this, _AiServer_instances, handleCommand_fn).call(this, obj.command, obj.message) };
      } catch (error) {
        answer = { error: errorText(error) };
      }
    }
    if (obj.callback) {
      this.sendTo(obj.from, obj.command, answer, obj.callback);
    }
  }
}
_client = new WeakMap();
_connected = new WeakMap();
_unloading = new WeakMap();
_retryTimer = new WeakMap();
_monitorTimer = new WeakMap();
_monitorRunning = new WeakMap();
_subscribed = new WeakMap();
_models = new WeakMap();
_refreshQueue = new WeakMap();
_pulling = new WeakMap();
_AiServer_instances = new WeakSet();
handleCommand_fn = async function(command, message) {
  switch (command) {
    case "listModels":
      return __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this);
    case "pull":
      __privateMethod(this, _AiServer_instances, startPull_fn).call(this, getModel(message));
      return { started: true };
    case "deleteModel": {
      const model = getModel(message);
      await __privateMethod(this, _AiServer_instances, requireClient_fn).call(this).deleteModel(model);
      this.log.info(`Model ${model} deleted`);
      await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this);
      return { deleted: true };
    }
    case "loadModel":
      await __privateMethod(this, _AiServer_instances, setLoaded_fn).call(this, getModel(message), true);
      return { loaded: true };
    case "unloadModel":
      await __privateMethod(this, _AiServer_instances, setLoaded_fn).call(this, getModel(message), false);
      return { unloaded: true };
    default:
      throw new Error(`Unknown command "${command}"`);
  }
};
/** The URL of the Ollama API without trailing slash, or null if the configured URL is invalid */
getBaseUrl_fn = function() {
  if (this.config.backend === "external") {
    const url = (this.config.externalUrl || "").trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }
  const host = this.config.bind && this.config.bind !== "0.0.0.0" ? this.config.bind : "127.0.0.1";
  return `http://${host}:${Number(this.config.port) || 11434}`;
};
checkDocker_fn = async function() {
  var _a;
  if (!this.config.dockerCpu && !this.config.dockerRocm) {
    return 'Backend "docker" is selected, but no Docker service is enabled. Please open the instance settings and save them again.';
  }
  const plugin = this.getPluginInstance("docker");
  const manager = (_a = plugin == null ? void 0 : plugin.getDockerManager) == null ? void 0 : _a.call(plugin);
  if (!manager) {
    return 'The Docker plugin is not active, so the Ollama container cannot be started. Select the backend "External Ollama server" in the instance settings to use an existing server.';
  }
  const info = await manager.getDockerDaemonInfo().catch(() => null);
  if (!(info == null ? void 0 : info.daemonRunning)) {
    return 'Docker is not available on this host. Install Docker Engine 20.10 or newer and add the user "iobroker" to the group "docker", or select the backend "External Ollama server" in the instance settings.';
  }
  this.log.debug(`Docker ${info.version || ""} is available`);
  return null;
};
/**
 * Ask /api/version until Ollama answers. On the first start the container may need a while
 * until it listens, and an external server may be down. There is no upper limit.
 */
waitForOllama_fn = function() {
  const started = Date.now();
  let delay = RETRY_MIN_MS;
  let infoLogged = false;
  const attempt = async () => {
    __privateSet(this, _retryTimer, void 0);
    if (__privateGet(this, _unloading) || !__privateGet(this, _client)) {
      return;
    }
    let version;
    try {
      version = await __privateGet(this, _client).getVersion(PROBE_TIMEOUT_MS);
    } catch (error) {
      if (__privateGet(this, _unloading)) {
        return;
      }
      if (!infoLogged && Date.now() - started >= WAIT_INFO_AFTER_MS) {
        infoLogged = true;
        this.log.info(
          this.config.backend === "docker" ? `Ollama does not answer yet (${errorText(error)}). The container may still be starting, the adapter keeps trying.` : `The external Ollama server does not answer yet (${errorText(error)}). The adapter keeps trying.`
        );
      } else {
        this.log.debug(`Ollama does not answer yet: ${errorText(error)}`);
      }
      __privateSet(this, _retryTimer, this.setTimeout(() => void attempt(), delay));
      delay = Math.min(delay * 2, RETRY_MAX_MS);
      return;
    }
    await __privateMethod(this, _AiServer_instances, onConnected_fn).call(this, version);
  };
  void attempt();
};
onConnected_fn = async function(version) {
  var _a;
  __privateSet(this, _connected, true);
  await this.setState("info.backendVersion", version, true);
  await this.setState("info.connection", true, true);
  await __privateMethod(this, _AiServer_instances, setStatus_fn).call(this, "ready");
  this.log.info(`Connected to Ollama ${version} at ${(_a = __privateGet(this, _client)) == null ? void 0 : _a.baseUrl}`);
  let models = null;
  try {
    models = await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this);
  } catch (error) {
    await __privateMethod(this, _AiServer_instances, reportError_fn).call(this, `Cannot read the models: ${errorText(error)}`);
  }
  if (!__privateGet(this, _subscribed)) {
    __privateSet(this, _subscribed, true);
    await this.subscribeStatesAsync("control.pull");
    await this.subscribeStatesAsync("control.refresh");
    await this.subscribeStatesAsync("models.*.load");
    await this.subscribeStatesAsync("models.*.unload");
  }
  __privateSet(this, _monitorTimer, this.setInterval(() => void __privateMethod(this, _AiServer_instances, monitor_fn).call(this), MONITOR_INTERVAL_MS));
  if (models) {
    __privateMethod(this, _AiServer_instances, ensureDefaultModel_fn).call(this, models);
  }
};
monitor_fn = async function() {
  if (__privateGet(this, _monitorRunning) || !__privateGet(this, _client) || !__privateGet(this, _connected)) {
    return;
  }
  __privateSet(this, _monitorRunning, true);
  try {
    let running;
    try {
      running = await __privateGet(this, _client).listRunningModels(PROBE_TIMEOUT_MS);
    } catch (error) {
      if (!__privateGet(this, _unloading)) {
        await __privateMethod(this, _AiServer_instances, onDisconnected_fn).call(this, error);
      }
      return;
    }
    await __privateMethod(this, _AiServer_instances, updateLoaded_fn).call(this, running);
  } catch (error) {
    this.log.warn(`Cannot update the models: ${errorText(error)}`);
  } finally {
    __privateSet(this, _monitorRunning, false);
  }
};
onDisconnected_fn = async function(error) {
  __privateMethod(this, _AiServer_instances, stopMonitor_fn).call(this);
  __privateSet(this, _connected, false);
  await this.setState("info.connection", false, true);
  await __privateMethod(this, _AiServer_instances, setError_fn).call(this, `Connection to Ollama lost: ${errorText(error)}`, "warn");
  __privateMethod(this, _AiServer_instances, waitForOllama_fn).call(this);
};
stopMonitor_fn = function() {
  if (__privateGet(this, _monitorTimer)) {
    this.clearInterval(__privateGet(this, _monitorTimer));
    __privateSet(this, _monitorTimer, void 0);
  }
};
/** The client, if Ollama is reachable. Commands fail with a clear message otherwise */
requireClient_fn = function() {
  if (!__privateGet(this, _client)) {
    throw new Error("Ollama is not available, see info.lastError");
  }
  if (!__privateGet(this, _connected)) {
    throw new Error(`Ollama does not answer at ${__privateGet(this, _client).baseUrl}`);
  }
  return __privateGet(this, _client);
};
/** Read the models from Ollama and bring the objects below `models` up to date */
refreshModels_fn = function() {
  const run = __privateGet(this, _refreshQueue).then(() => __privateMethod(this, _AiServer_instances, syncModels_fn).call(this));
  __privateSet(this, _refreshQueue, run.catch(() => void 0));
  return run;
};
syncModels_fn = async function() {
  const client = __privateMethod(this, _AiServer_instances, requireClient_fn).call(this);
  const [models, running] = await Promise.all([client.listModels(), client.listRunningModels()]);
  const infos = (0, import_models.toModelInfos)(models, running);
  const current = /* @__PURE__ */ new Map();
  for (const info of infos) {
    const id = (0, import_objects.toModelId)(info.name, this.FORBIDDEN_CHARS);
    const other = current.get(id);
    if (other) {
      this.log.warn(
        `The models ${other} and ${info.name} get the same object ID "${id}", only ${other} is shown`
      );
      continue;
    }
    current.set(id, info.name);
    if (__privateGet(this, _models).get(id) !== info.name) {
      await this.extendObject(`models.${id}`, { type: "channel", common: { name: info.name }, native: {} });
      for (const [key, common] of Object.entries(import_objects.MODEL_STATES)) {
        await this.extendObject(`models.${id}.${key}`, { type: "state", common, native: {} });
      }
    }
    for (const [key, value] of Object.entries(info)) {
      await this.setStateChangedAsync(`models.${id}.${key}`, value, true);
    }
  }
  const prefix = `${this.namespace}.models.`;
  const channels = await this.getObjectViewAsync("system", "channel", {
    startkey: prefix,
    endkey: `${prefix}\u9999`
  });
  for (const row of channels.rows) {
    const id = row.id.substring(prefix.length);
    if (!id.includes(".") && !current.has(id)) {
      this.log.debug(`Model ${id} does not exist any more, deleting its objects`);
      await this.delObjectAsync(`models.${id}`, { recursive: true });
    }
  }
  __privateSet(this, _models, current);
  return infos;
};
updateLoaded_fn = async function(running) {
  const known = [...__privateGet(this, _models).values()];
  if (running.some((item) => !known.some((name) => (0, import_models.sameModel)(name, item.name || item.model)))) {
    await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this);
    return;
  }
  for (const [id, name] of __privateGet(this, _models)) {
    const loaded = running.some((item) => (0, import_models.sameModel)(item.name || item.model, name));
    await this.setStateChangedAsync(`models.${id}.loaded`, loaded, true);
  }
};
setLoaded_fn = async function(model, load) {
  const client = __privateMethod(this, _AiServer_instances, requireClient_fn).call(this);
  if (load) {
    await client.loadModel(model, this.config.keepAlive);
  } else {
    await client.unloadModel(model);
  }
  this.log.info(`Model ${model} ${load ? "loaded" : "unloaded"}`);
  await __privateMethod(this, _AiServer_instances, updateLoaded_fn).call(this, await client.listRunningModels());
};
/**
 * Download the default model if Ollama does not have it, e.g. on the first start
 *
 * @param models the downloaded models
 */
ensureDefaultModel_fn = function(models) {
  const model = (this.config.defaultModel || "").trim();
  if (!model || __privateGet(this, _pulling) || models.some((item) => (0, import_models.sameModel)(item.name, model))) {
    return;
  }
  this.log.info(`The default model ${model} is not downloaded yet, downloading it now`);
  try {
    __privateMethod(this, _AiServer_instances, startPull_fn).call(this, model);
  } catch (error) {
    void __privateMethod(this, _AiServer_instances, reportError_fn).call(this, `Cannot download the default model: ${errorText(error)}`);
  }
};
/**
 * Start the download of a model. Its progress goes to `control.pullProgress`, the result to the log
 *
 * @param model name of the model
 */
startPull_fn = function(model) {
  const client = __privateMethod(this, _AiServer_instances, requireClient_fn).call(this);
  if (!(0, import_ollama_client.isValidModelName)(model)) {
    throw new Error(`Invalid model name: ${JSON.stringify(model)}`);
  }
  if (__privateGet(this, _pulling)) {
    throw new Error(`The download of ${__privateGet(this, _pulling)} is still running`);
  }
  __privateSet(this, _pulling, model);
  void __privateMethod(this, _AiServer_instances, pull_fn).call(this, client, model);
};
pull_fn = async function(client, model) {
  let lastWrite = 0;
  let lastPercent = 0;
  const writeProgress = (percent) => {
    this.setState("control.pullProgress", percent, true).catch(
      (error) => this.log.debug(`Cannot write the progress: ${errorText(error)}`)
    );
  };
  try {
    await this.setState("control.pull", model, true);
    await this.setState("control.pullProgress", 0, true);
    this.log.info(`Downloading model ${model}`);
    await client.pull(model, (_status, percent) => {
      const now = Date.now();
      if (percent === null || percent === lastPercent || now - lastWrite < PULL_PROGRESS_INTERVAL_MS) {
        return;
      }
      lastWrite = now;
      lastPercent = percent;
      writeProgress(percent);
    });
    await this.setState("control.pullProgress", 100, true);
    this.log.info(`Model ${model} downloaded`);
  } catch (error) {
    if (!__privateGet(this, _unloading)) {
      await this.setState("control.pullProgress", 0, true);
      await __privateMethod(this, _AiServer_instances, reportError_fn).call(this, `Cannot download model ${model}: ${errorText(error)}`);
    }
    return;
  } finally {
    __privateSet(this, _pulling, null);
  }
  await __privateMethod(this, _AiServer_instances, refreshModels_fn).call(this).catch((error) => __privateMethod(this, _AiServer_instances, reportError_fn).call(this, `Cannot read the models: ${errorText(error)}`));
};
setStatus_fn = async function(status) {
  await this.setState("info.status", status, true);
};
setError_fn = async function(message, level = "error") {
  this.log[level](message);
  await this.setState("info.lastError", message, true);
  await __privateMethod(this, _AiServer_instances, setStatus_fn).call(this, "error");
};
reportError_fn = async function(message) {
  this.log.error(message);
  await this.setState("info.lastError", message, true);
};
if (require.main !== module) {
  module.exports = (options) => new AiServer(options);
} else {
  (() => new AiServer())();
}
//# sourceMappingURL=main.js.map
