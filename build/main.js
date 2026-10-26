"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
class AiServer extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "ai-server"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   * The container itself is started by plugin-docker (see docker-compose.yaml), not by the adapter.
   */
  async onReady() {
    await this.setState("info.connection", false, true);
    if (this.config.backend === "docker") {
      const service = this.config.dockerRocm ? "ollama-rocm" : this.config.dockerCpu ? "ollama" : "";
      if (service) {
        this.log.info(
          `Ollama runs in the Docker service "${service}" on ${this.config.bind}:${this.config.port}`
        );
      } else {
        this.log.warn(
          'Backend "docker" is selected, but no Docker service is enabled. Please save the configuration again.'
        );
      }
    } else {
      this.log.info(`Using the external Ollama server ${this.config.externalUrl}`);
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      void this.setState("info.connection", false, true);
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
    } finally {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new AiServer(options);
} else {
  (() => new AiServer())();
}
//# sourceMappingURL=main.js.map
