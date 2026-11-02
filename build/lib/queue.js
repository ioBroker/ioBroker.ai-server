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
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});
var queue_exports = {};
__export(queue_exports, {
  QueueFullError: () => QueueFullError,
  RequestQueue: () => RequestQueue
});
module.exports = __toCommonJS(queue_exports);
var _parallel, _maxQueue, _onChange, _waiting, _running, _RequestQueue_instances, start_fn, changed_fn;
class QueueFullError extends Error {
  /** @param maxQueue the maximal number of waiting requests */
  constructor(maxQueue) {
    super(
      maxQueue > 0 ? `Too many requests: ${maxQueue} are already waiting, try again later` : "The model is busy, try again later"
    );
    this.name = "QueueFullError";
  }
}
class RequestQueue {
  /** @param options limits and change listener */
  constructor(options) {
    __privateAdd(this, _RequestQueue_instances);
    __privateAdd(this, _parallel);
    __privateAdd(this, _maxQueue);
    __privateAdd(this, _onChange);
    __privateAdd(this, _waiting, []);
    __privateAdd(this, _running, 0);
    __privateSet(this, _parallel, Math.max(1, Math.floor(Number(options.parallel) || 1)));
    __privateSet(this, _maxQueue, Math.max(0, Math.floor(Number(options.maxQueue) || 0)));
    __privateSet(this, _onChange, options.onChange);
  }
  /** Number of running tasks */
  get running() {
    return __privateGet(this, _running);
  }
  /** Number of waiting tasks */
  get waiting() {
    return __privateGet(this, _waiting).length;
  }
  /**
   * Run the task as soon as there is a free slot
   *
   * @param task the request
   * @returns the result of the task. Fails with QueueFullError if the queue is full
   */
  run(task) {
    if (__privateGet(this, _running) < __privateGet(this, _parallel)) {
      return __privateMethod(this, _RequestQueue_instances, start_fn).call(this, task);
    }
    if (__privateGet(this, _waiting).length >= __privateGet(this, _maxQueue)) {
      return Promise.reject(new QueueFullError(__privateGet(this, _maxQueue)));
    }
    return new Promise((resolve, reject) => {
      __privateGet(this, _waiting).push({ start: () => __privateMethod(this, _RequestQueue_instances, start_fn).call(this, task).then(resolve, reject), reject });
      __privateMethod(this, _RequestQueue_instances, changed_fn).call(this);
    });
  }
  /**
   * Reject all waiting tasks, e.g. when the adapter stops. Running tasks are not touched
   *
   * @param error the reason given to the waiting tasks
   */
  clear(error) {
    const waiting = __privateGet(this, _waiting).splice(0);
    for (const item of waiting) {
      item.reject(error);
    }
    if (waiting.length) {
      __privateMethod(this, _RequestQueue_instances, changed_fn).call(this);
    }
  }
}
_parallel = new WeakMap();
_maxQueue = new WeakMap();
_onChange = new WeakMap();
_waiting = new WeakMap();
_running = new WeakMap();
_RequestQueue_instances = new WeakSet();
start_fn = async function(task) {
  __privateWrapper(this, _running)._++;
  __privateMethod(this, _RequestQueue_instances, changed_fn).call(this);
  try {
    return await task();
  } finally {
    __privateWrapper(this, _running)._--;
    const next = __privateGet(this, _waiting).shift();
    if (next) {
      next.start();
    } else {
      __privateMethod(this, _RequestQueue_instances, changed_fn).call(this);
    }
  }
};
changed_fn = function() {
  var _a;
  (_a = __privateGet(this, _onChange)) == null ? void 0 : _a.call(this, __privateGet(this, _running), __privateGet(this, _waiting).length);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  QueueFullError,
  RequestQueue
});
//# sourceMappingURL=queue.js.map
