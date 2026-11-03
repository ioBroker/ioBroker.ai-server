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
var endpoint_exports = {};
__export(endpoint_exports, {
  escapeHtml: () => escapeHtml,
  getEndpoints: () => getEndpoints,
  hostAddresses: () => hostAddresses
});
module.exports = __toCommonJS(endpoint_exports);
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|cni|flannel)/;
function hostAddresses(interfaces) {
  return Object.entries(interfaces).filter(([name]) => !VIRTUAL_INTERFACE.test(name)).flatMap(([, infos]) => infos || []).filter((info) => info.family === "IPv4" && !info.internal).map((info) => info.address);
}
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}
function withPort(host, port) {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}
function getEndpoints(settings, addresses) {
  if (settings.backend === "external") {
    const url = asText(settings.externalUrl).replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return { urls: [url], localOnly: ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) };
  }
  const port = Number(settings.port) || 11434;
  const bind = asText(settings.bind);
  if (!bind || bind === "127.0.0.1" || bind === "localhost" || bind === "::1") {
    return { urls: [withPort("127.0.0.1", port)], localOnly: true };
  }
  if (bind === "0.0.0.0" || bind === "::") {
    return addresses.length ? { urls: addresses.map((address) => withPort(address, port)), localOnly: false } : { urls: [withPort("127.0.0.1", port)], localOnly: true };
  }
  return { urls: [withPort(bind, port)], localOnly: false };
}
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  escapeHtml,
  getEndpoints,
  hostAddresses
});
//# sourceMappingURL=endpoint.js.map
