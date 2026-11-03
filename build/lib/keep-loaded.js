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
var keep_loaded_exports = {};
__export(keep_loaded_exports, {
  KEEP_FOREVER: () => KEEP_FOREVER,
  keepAliveFor: () => keepAliveFor,
  keepLoadedAction: () => keepLoadedAction
});
module.exports = __toCommonJS(keep_loaded_exports);
var import_models = require("./models");
const KEEP_FOREVER = -1;
const LOADED_FOR_GOOD_MS = 365 * 24 * 60 * 6e4;
function keepLoadedAction(model, running, now = Date.now()) {
  const loaded = running.find((item) => (0, import_models.sameModel)(item.name || item.model, model));
  if (!loaded) {
    return running.length ? "none" : "load";
  }
  const expires = loaded.expires_at ? Date.parse(loaded.expires_at) : NaN;
  return Number.isFinite(expires) && expires - now < LOADED_FOR_GOOD_MS ? "pin" : "none";
}
function keepAliveFor(model, keepAlive, keptModel) {
  return keptModel && (0, import_models.sameModel)(model, keptModel) ? KEEP_FOREVER : keepAlive;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KEEP_FOREVER,
  keepAliveFor,
  keepLoadedAction
});
//# sourceMappingURL=keep-loaded.js.map
