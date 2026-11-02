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
var objects_exports = {};
__export(objects_exports, {
  MODEL_STATES: () => MODEL_STATES,
  parseModelCommand: () => parseModelCommand,
  toModelId: () => toModelId
});
module.exports = __toCommonJS(objects_exports);
function toModelId(name, forbiddenChars) {
  return name.replace(forbiddenChars, "_").replace(/[.:/]/g, "_");
}
const MODEL_STATES = {
  name: { name: "Name of the model", type: "string", role: "text", read: true, write: false },
  size: { name: "Size on disk", type: "number", role: "value", unit: "B", read: true, write: false },
  parameterSize: { name: "Number of parameters", type: "string", role: "text", read: true, write: false },
  quantization: { name: "Quantization", type: "string", role: "text", read: true, write: false },
  loaded: { name: "Loaded into memory", type: "boolean", role: "indicator", read: true, write: false },
  load: { name: "Load the model into memory", type: "boolean", role: "button", read: false, write: true },
  unload: { name: "Unload the model from memory", type: "boolean", role: "button", read: false, write: true }
};
function parseModelCommand(localId) {
  const match = /^models\.([^.]+)\.(load|unload)$/.exec(localId);
  return match ? { id: match[1], command: match[2] } : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MODEL_STATES,
  parseModelCommand,
  toModelId
});
//# sourceMappingURL=objects.js.map
