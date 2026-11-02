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
var usage_exports = {};
__export(usage_exports, {
  DAY_MS: () => DAY_MS,
  LAST_USED_RESOLUTION_MS: () => LAST_USED_RESOLUTION_MS,
  daysSince: () => daysSince,
  findUnusedModels: () => findUnusedModels
});
module.exports = __toCommonJS(usage_exports);
var import_models = require("./models");
const DAY_MS = 24 * 60 * 60 * 1e3;
const LAST_USED_RESOLUTION_MS = 10 * 60 * 1e3;
function daysSince(lastUsed, now) {
  return Math.max(0, Math.floor((now - lastUsed) / DAY_MS));
}
function findUnusedModels(models, now, days, keep) {
  if (!(days > 0)) {
    return [];
  }
  return models.filter(
    (model) => !model.loaded && model.lastUsed !== void 0 && now - model.lastUsed >= days * DAY_MS && !keep.some((name) => name && (0, import_models.sameModel)(name, model.name))
  ).map((model) => model.name);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DAY_MS,
  LAST_USED_RESOLUTION_MS,
  daysSince,
  findUnusedModels
});
//# sourceMappingURL=usage.js.map
