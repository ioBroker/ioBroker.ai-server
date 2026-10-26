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
var import_ollama_client = require("./lib/ollama-client");
var _client, _connected, _unloading, _retryTimer, _monitorTimer, _monitorRunning, _AiServer_instances, getBaseUrl_fn, checkDocker_fn, waitForOllama_fn, onConnected_fn, monitor_fn, onDisconnected_fn, stopMonitor_fn, setStatus_fn, setError_fn;
const RETRY_MIN_MS = 2e3;
const RETRY_MAX_MS = 3e4;
const WAIT_INFO_AFTER_MS = 6e4;
const MONITOR_INTERVAL_MS = 3e4;
const PROBE_TIMEOUT_MS = 5e3;
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
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
    this.on("ready", this.onReady.bind(this));
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
}
_client = new WeakMap();
_connected = new WeakMap();
_unloading = new WeakMap();
_retryTimer = new WeakMap();
_monitorTimer = new WeakMap();
_monitorRunning = new WeakMap();
_AiServer_instances = new WeakSet();
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
  __privateSet(this, _monitorTimer, this.setInterval(() => void __privateMethod(this, _AiServer_instances, monitor_fn).call(this), MONITOR_INTERVAL_MS));
};
monitor_fn = async function() {
  if (__privateGet(this, _monitorRunning) || !__privateGet(this, _client) || !__privateGet(this, _connected)) {
    return;
  }
  __privateSet(this, _monitorRunning, true);
  try {
    await __privateGet(this, _client).listRunningModels(PROBE_TIMEOUT_MS);
  } catch (error) {
    if (!__privateGet(this, _unloading)) {
      await __privateMethod(this, _AiServer_instances, onDisconnected_fn).call(this, error);
    }
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
setStatus_fn = async function(status) {
  await this.setState("info.status", status, true);
};
setError_fn = async function(message, level = "error") {
  this.log[level](message);
  await this.setState("info.lastError", message, true);
  await __privateMethod(this, _AiServer_instances, setStatus_fn).call(this, "error");
};
if (require.main !== module) {
  module.exports = (options) => new AiServer(options);
} else {
  (() => new AiServer())();
}
//# sourceMappingURL=main.js.map
