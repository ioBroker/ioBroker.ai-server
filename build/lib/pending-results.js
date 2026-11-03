"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
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
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var pending_results_exports = {};
__export(pending_results_exports, {
  PendingResults: () => PendingResults
});
module.exports = __toCommonJS(pending_results_exports);
var import_node_crypto = require("node:crypto");
var _jobs, _options;
class PendingResults {
  constructor(options) {
    __privateAdd(this, _jobs, /* @__PURE__ */ new Map());
    __privateAdd(this, _options);
    __privateSet(this, _options, options);
  }
  /** Number of results that were not fetched yet */
  get size() {
    return __privateGet(this, _jobs).size;
  }
  /**
   * Remember a running request
   *
   * @param task the request
   * @returns the ID to fetch the result with
   */
  start(task) {
    const id = (0, import_node_crypto.randomUUID)();
    const job = { promise: task, settled: false, failed: false };
    __privateGet(this, _jobs).set(id, job);
    const settle = () => {
      job.settled = true;
      if (__privateGet(this, _jobs).get(id) === job) {
        job.expiry = __privateGet(this, _options).timers.setTimeout(() => __privateGet(this, _jobs).delete(id), __privateGet(this, _options).keepMs);
      }
    };
    void task.then(
      (value) => {
        job.value = value;
        settle();
      },
      (error) => {
        job.failed = true;
        job.error = error;
        settle();
      }
    );
    return id;
  }
  /**
   * Wait for the result of a request, at most `maxWaitMs`. A fetched result is forgotten.
   *
   * @param id the ID returned by {@link start}
   * @param maxWaitMs how long to wait for a request that is still running
   * @returns the result, or `{ done: false }` if the request is still running. Throws the error of the request.
   */
  async wait(id, maxWaitMs) {
    const job = __privateGet(this, _jobs).get(id);
    if (!job) {
      throw new Error("Unknown request: it was fetched already, or the instance was restarted meanwhile");
    }
    if (!job.settled) {
      let timer;
      await Promise.race([
        job.promise.catch(() => void 0),
        new Promise((resolve) => {
          timer = __privateGet(this, _options).timers.setTimeout(resolve, maxWaitMs);
        })
      ]);
      __privateGet(this, _options).timers.clearTimeout(timer);
      await Promise.resolve();
      if (!job.settled) {
        return { done: false };
      }
    }
    __privateGet(this, _jobs).delete(id);
    __privateGet(this, _options).timers.clearTimeout(job.expiry);
    if (job.failed) {
      throw job.error;
    }
    return { done: true, result: job.value };
  }
  /** Forget all results, e.g. when the adapter stops */
  clear() {
    for (const job of __privateGet(this, _jobs).values()) {
      __privateGet(this, _options).timers.clearTimeout(job.expiry);
    }
    __privateGet(this, _jobs).clear();
  }
}
_jobs = new WeakMap();
_options = new WeakMap();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PendingResults
});
//# sourceMappingURL=pending-results.js.map
