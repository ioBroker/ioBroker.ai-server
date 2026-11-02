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
var models_exports = {};
__export(models_exports, {
  RECOMMENDED_MODELS: () => RECOMMENDED_MODELS,
  formatSize: () => formatSize,
  modelOptions: () => modelOptions,
  normalizeModelName: () => normalizeModelName,
  sameModel: () => sameModel,
  toModelInfos: () => toModelInfos
});
module.exports = __toCommonJS(models_exports);
const RECOMMENDED_MODELS = [
  { name: "qwen3:1.7b", size: 1359293444 },
  { name: "llama3.2:3b", size: 2019393189 },
  { name: "qwen3:4b", size: 2497293931 },
  { name: "qwen3.5:4b", size: 3324173934 },
  { name: "qwen3:8b", size: 5225388164 },
  { name: "qwen3.5:9b", size: 6550825550 },
  { name: "gemma4:e4b", size: 6583656505 },
  { name: "gpt-oss:20b", size: 13793441566 }
];
function normalizeModelName(name) {
  let result = name.trim().toLowerCase();
  result = result.replace(/^registry\.ollama\.ai\//, "").replace(/^library\//, "");
  const lastPart = result.substring(result.lastIndexOf("/") + 1);
  return lastPart.includes(":") ? result : `${result}:latest`;
}
function sameModel(a, b) {
  return normalizeModelName(a) === normalizeModelName(b);
}
function toModelInfos(models, running) {
  return models.map((model) => {
    var _a, _b, _c, _d;
    return {
      name: model.name,
      size: model.size,
      parameterSize: (_b = (_a = model.details) == null ? void 0 : _a.parameter_size) != null ? _b : "",
      quantization: (_d = (_c = model.details) == null ? void 0 : _c.quantization_level) != null ? _d : "",
      loaded: running.some((item) => sameModel(item.name || item.model, model.name))
    };
  });
}
function formatSize(bytes) {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
function modelOptions(installed) {
  const options = [...installed].sort((a, b) => a.name.localeCompare(b.name)).map((model) => ({
    value: model.name,
    label: `\u2713 ${model.name} (${formatSize(model.size)})`,
    noTranslation: true
  }));
  for (const model of RECOMMENDED_MODELS) {
    if (!installed.some((item) => sameModel(item.name, model.name))) {
      options.push({
        value: model.name,
        label: `${model.name} (${formatSize(model.size)})`,
        noTranslation: true
      });
    }
  }
  return options;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RECOMMENDED_MODELS,
  formatSize,
  modelOptions,
  normalizeModelName,
  sameModel,
  toModelInfos
});
//# sourceMappingURL=models.js.map
