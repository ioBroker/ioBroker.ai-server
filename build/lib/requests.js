"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var requests_exports = {};
__export(requests_exports, {
  shorten: () => shorten,
  toChatRequest: () => toChatRequest,
  toGenerateRequest: () => toGenerateRequest,
  toMetrics: () => toMetrics
});
module.exports = __toCommonJS(requests_exports);
var import_ollama_client = require("./ollama-client");
const ROLES = ["system", "user", "assistant", "tool"];
function asObject(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("The message has to be an object");
  }
  return message;
}
function pickModel(model, defaults) {
  const name = typeof model === "string" && model.trim() ? model.trim() : (defaults.model || "").trim();
  if (!name) {
    throw new Error("No model given and no default model set in the instance settings");
  }
  return name;
}
function optionalString(value, name) {
  if (value === void 0 || value === null) {
    return void 0;
  }
  if (typeof value !== "string") {
    throw new Error(`"${name}" has to be a text`);
  }
  return value;
}
function passThrough(input) {
  const result = {};
  if (input.format !== void 0) {
    result.format = input.format;
  }
  if (input.options !== void 0) {
    result.options = input.options;
  }
  if (input.think !== void 0) {
    result.think = input.think;
  }
  return result;
}
function toChatRequest(message, defaults) {
  const input = asObject(message);
  if (!Array.isArray(input.messages) || !input.messages.length) {
    throw new Error('"messages" has to be a non-empty list, e.g. [{ "role": "user", "content": "Hello" }]');
  }
  input.messages.forEach((item, index) => {
    const entry = item && typeof item === "object" ? item : null;
    if (!entry || typeof entry.role !== "string" || !ROLES.includes(entry.role)) {
      throw new Error(`messages[${index}]: "role" has to be one of ${ROLES.join(", ")}`);
    }
    if (typeof entry.content !== "string") {
      throw new Error(`messages[${index}]: "content" has to be a text`);
    }
    if (entry.images !== void 0 && (!Array.isArray(entry.images) || entry.images.some((image) => typeof image !== "string"))) {
      throw new Error(`messages[${index}]: "images" has to be a list of base64 texts`);
    }
  });
  const system = optionalString(input.system, "system");
  const messages = input.messages;
  const request = {
    model: pickModel(input.model, defaults),
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    keep_alive: (0, import_ollama_client.toKeepAlive)(defaults.keepAlive),
    ...passThrough(input)
  };
  if (input.tools !== void 0) {
    request.tools = input.tools;
  }
  return request;
}
function toGenerateRequest(message, defaults) {
  const input = asObject(message);
  const prompt = optionalString(input.prompt, "prompt");
  if (!prompt) {
    throw new Error('"prompt" has to be a non-empty text');
  }
  const request = {
    model: pickModel(input.model, defaults),
    prompt,
    keep_alive: (0, import_ollama_client.toKeepAlive)(defaults.keepAlive),
    ...passThrough(input)
  };
  const system = optionalString(input.system, "system");
  if (system) {
    request.system = system;
  }
  return request;
}
function toMetrics(stats, durationMs) {
  var _a, _b, _c;
  const completionTokens = (_a = stats.eval_count) != null ? _a : 0;
  const evalSeconds = ((_b = stats.eval_duration) != null ? _b : 0) / 1e9;
  return {
    durationMs,
    promptTokens: (_c = stats.prompt_eval_count) != null ? _c : 0,
    completionTokens,
    tokensPerSecond: evalSeconds > 0 ? Math.round(completionTokens / evalSeconds * 10) / 10 : 0
  };
}
function shorten(text, max = 200) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}\u2026` : oneLine;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  shorten,
  toChatRequest,
  toGenerateRequest,
  toMetrics
});
//# sourceMappingURL=requests.js.map
