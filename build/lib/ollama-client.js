"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var ollama_client_exports = {};
__export(ollama_client_exports, {
  MODEL_NAME_PATTERN: () => MODEL_NAME_PATTERN,
  NdjsonParser: () => NdjsonParser,
  OllamaClient: () => OllamaClient,
  OllamaError: () => OllamaError,
  PullProgress: () => PullProgress,
  isValidModelName: () => isValidModelName,
  toKeepAlive: () => toKeepAlive
});
module.exports = __toCommonJS(ollama_client_exports);
var _buffer, _NdjsonParser_static, parse_fn, _layers, _timeoutMs, _fetch, _timers, _controllers, _OllamaClient_static, checkModel_fn, _OllamaClient_instances, requestJson_fn, withAbort_fn, send_fn;
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
function isValidModelName(name) {
  return typeof name === "string" && MODEL_NAME_PATTERN.test(name);
}
function toKeepAlive(value) {
  const text = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text || "5m";
}
class OllamaError extends Error {
  /** HTTP status of the answer, if Ollama answered at all */
  status;
  /**
   * @param message error text
   * @param status HTTP status of the answer
   */
  constructor(message, status) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
  }
}
const _NdjsonParser = class _NdjsonParser {
  constructor() {
    __privateAdd(this, _buffer, "");
  }
  /**
   * Add a chunk of the stream
   *
   * @param chunk text as received, may end in the middle of a line
   * @returns all objects whose line is complete
   */
  push(chunk) {
    var _a, _b;
    __privateSet(this, _buffer, __privateGet(this, _buffer) + chunk);
    const lines = __privateGet(this, _buffer).split("\n");
    __privateSet(this, _buffer, (_a = lines.pop()) != null ? _a : "");
    return __privateMethod(_b = _NdjsonParser, _NdjsonParser_static, parse_fn).call(_b, lines);
  }
  /** Return the last object, if the stream did not end with a line break */
  flush() {
    var _a;
    const rest = __privateGet(this, _buffer);
    __privateSet(this, _buffer, "");
    return __privateMethod(_a = _NdjsonParser, _NdjsonParser_static, parse_fn).call(_a, [rest]);
  }
};
_buffer = new WeakMap();
_NdjsonParser_static = new WeakSet();
parse_fn = function(lines) {
  const result = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    try {
      result.push(JSON.parse(text));
    } catch {
      throw new OllamaError(`Invalid line in the answer of Ollama: ${text.slice(0, 100)}`);
    }
  }
  return result;
};
__privateAdd(_NdjsonParser, _NdjsonParser_static);
let NdjsonParser = _NdjsonParser;
class PullProgress {
  constructor() {
    __privateAdd(this, _layers, /* @__PURE__ */ new Map());
  }
  /**
   * Take the next status message into account
   *
   * @param status one line of the pull stream
   * @returns progress from 0 to 100, or null if the message says nothing about the progress
   */
  update(status) {
    var _a;
    if (status.status === "success") {
      return 100;
    }
    if (!status.digest || !status.total) {
      return null;
    }
    __privateGet(this, _layers).set(status.digest, {
      total: status.total,
      completed: Math.min((_a = status.completed) != null ? _a : 0, status.total)
    });
    let total = 0;
    let completed = 0;
    for (const layer of __privateGet(this, _layers).values()) {
      total += layer.total;
      completed += layer.completed;
    }
    return Math.min(99, Math.floor(completed / total * 100));
  }
}
_layers = new WeakMap();
function describeError(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    return (cause == null ? void 0 : cause.code) || (cause == null ? void 0 : cause.message) || error.message;
  }
  return String(error);
}
async function readError(response) {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    if (json.error) {
      return json.error;
    }
  } catch {
  }
  return text.trim() || `HTTP ${response.status} ${response.statusText}`.trim();
}
const _OllamaClient = class _OllamaClient {
  /** @param options base URL, timeout and optional replacements for fetch and the timers */
  constructor(options) {
    __privateAdd(this, _OllamaClient_instances);
    __publicField(this, "baseUrl");
    __privateAdd(this, _timeoutMs);
    __privateAdd(this, _fetch);
    __privateAdd(this, _timers);
    __privateAdd(this, _controllers, /* @__PURE__ */ new Set());
    var _a, _b;
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    __privateSet(this, _timeoutMs, options.timeoutMs);
    __privateSet(this, _fetch, (_a = options.fetch) != null ? _a : fetch);
    __privateSet(this, _timers, (_b = options.timers) != null ? _b : {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    });
  }
  /**
   * `GET /api/version`
   *
   * @param timeoutMs overrides the default timeout, e.g. for a short availability check
   */
  async getVersion(timeoutMs) {
    var _a;
    const answer = await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "GET", "/api/version", void 0, timeoutMs);
    return (_a = answer.version) != null ? _a : "";
  }
  /** `GET /api/tags`: the models available locally */
  async listModels() {
    var _a;
    const answer = await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "GET", "/api/tags");
    return (_a = answer.models) != null ? _a : [];
  }
  /**
   * `GET /api/ps`: the models loaded into memory
   *
   * @param timeoutMs overrides the default timeout
   */
  async listRunningModels(timeoutMs) {
    var _a;
    const answer = await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "GET", "/api/ps", void 0, timeoutMs);
    return (_a = answer.models) != null ? _a : [];
  }
  /**
   * `DELETE /api/delete`
   *
   * @param model name of the model
   */
  async deleteModel(model) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, model);
    await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "DELETE", "/api/delete", { model });
  }
  /**
   * Load a model into memory: `POST /api/generate` without a prompt
   *
   * @param model name of the model
   * @param keepAlive how long the model stays loaded, e.g. "5m" or -1
   */
  async loadModel(model, keepAlive) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, model);
    await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "POST", "/api/generate", { model, keep_alive: toKeepAlive(keepAlive) });
  }
  /**
   * Unload a model from memory: `POST /api/generate` with `keep_alive: 0`
   *
   * @param model name of the model
   */
  async unloadModel(model) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, model);
    await __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "POST", "/api/generate", { model, keep_alive: 0 });
  }
  /**
   * `POST /api/chat` without streaming
   *
   * @param request model, messages and optional parameters, passed to Ollama unchanged
   */
  async chat(request) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, request.model);
    return __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "POST", "/api/chat", { ...request, stream: false });
  }
  /**
   * `POST /api/generate` without streaming
   *
   * @param request model, prompt and optional parameters, passed to Ollama unchanged
   */
  async generate(request) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, request.model);
    return __privateMethod(this, _OllamaClient_instances, requestJson_fn).call(this, "POST", "/api/generate", { ...request, stream: false });
  }
  /**
   * `POST /api/pull` with streaming. A download of several GB takes longer than any sensible
   * request timeout, so here the timeout applies to the silence between two messages.
   *
   * @param model name of the model
   * @param onStatus called for every message with the overall progress (null if unknown)
   */
  async pull(model, onStatus) {
    var _a;
    __privateMethod(_a = _OllamaClient, _OllamaClient_static, checkModel_fn).call(_a, model);
    await __privateMethod(this, _OllamaClient_instances, withAbort_fn).call(this, __privateGet(this, _timeoutMs), async (signal, touch) => {
      const response = await __privateMethod(this, _OllamaClient_instances, send_fn).call(this, "POST", "/api/pull", { model, stream: true }, signal);
      if (!response.body) {
        throw new OllamaError("Ollama sent an empty answer");
      }
      const parser = new NdjsonParser();
      const progress = new PullProgress();
      const decoder = new TextDecoder();
      let success = false;
      const handle = (items) => {
        for (const item of items) {
          const status = item;
          if (status.error) {
            throw new OllamaError(status.error);
          }
          if (status.status === "success") {
            success = true;
          }
          onStatus == null ? void 0 : onStatus(status, progress.update(status));
        }
      };
      const reader = response.body.getReader();
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        touch();
        handle(parser.push(decoder.decode(value, { stream: true })));
      }
      handle(parser.push(decoder.decode()));
      handle(parser.flush());
      if (!success) {
        throw new OllamaError(`The download of ${model} ended without success`);
      }
    });
  }
  /** Abort all running requests, e.g. when the adapter unloads */
  abortAll() {
    for (const controller of __privateGet(this, _controllers)) {
      controller.abort();
    }
    __privateGet(this, _controllers).clear();
  }
};
_timeoutMs = new WeakMap();
_fetch = new WeakMap();
_timers = new WeakMap();
_controllers = new WeakMap();
_OllamaClient_static = new WeakSet();
checkModel_fn = function(model) {
  if (!isValidModelName(model)) {
    throw new OllamaError(`Invalid model name: ${JSON.stringify(model)}`);
  }
};
_OllamaClient_instances = new WeakSet();
requestJson_fn = async function(method, path, body, timeoutMs) {
  return __privateMethod(this, _OllamaClient_instances, withAbort_fn).call(this, timeoutMs != null ? timeoutMs : __privateGet(this, _timeoutMs), async (signal) => {
    const response = await __privateMethod(this, _OllamaClient_instances, send_fn).call(this, method, path, body, signal);
    const text = await response.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new OllamaError(`Invalid answer of Ollama for ${path}: ${text.slice(0, 100)}`);
    }
  });
};
withAbort_fn = async function(timeoutMs, task) {
  const controller = new AbortController();
  __privateGet(this, _controllers).add(controller);
  let timedOut = false;
  let timer;
  const touch = () => {
    __privateGet(this, _timers).clearTimeout(timer);
    timer = __privateGet(this, _timers).setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  touch();
  try {
    return await task(controller.signal, touch);
  } catch (error) {
    const aborted = controller.signal.aborted;
    controller.abort();
    if (timedOut) {
      throw new OllamaError(`Ollama did not answer within ${Math.round(timeoutMs / 1e3)} s`);
    }
    if (aborted) {
      throw new OllamaError("The request to Ollama was aborted");
    }
    throw error;
  } finally {
    __privateGet(this, _timers).clearTimeout(timer);
    __privateGet(this, _controllers).delete(controller);
  }
};
send_fn = async function(method, path, body, signal) {
  let response;
  try {
    response = await __privateGet(this, _fetch).call(this, `${this.baseUrl}${path}`, {
      method,
      headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new OllamaError(`Cannot reach Ollama at ${this.baseUrl}: ${describeError(error)}`);
  }
  if (!response.ok) {
    throw new OllamaError(await readError(response), response.status);
  }
  return response;
};
__privateAdd(_OllamaClient, _OllamaClient_static);
let OllamaClient = _OllamaClient;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MODEL_NAME_PATTERN,
  NdjsonParser,
  OllamaClient,
  OllamaError,
  PullProgress,
  isValidModelName,
  toKeepAlive
});
//# sourceMappingURL=ollama-client.js.map
