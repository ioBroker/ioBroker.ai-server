"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var device_management_exports = {};
__export(device_management_exports, {
  ModelManagement: () => ModelManagement
});
module.exports = __toCommonJS(device_management_exports);
var I18n = __toESM(require("@iobroker/adapter-core/i18n"));
var import_dm_utils = require("@iobroker/dm-utils");
var import_models = require("./models");
var import_ollama_client = require("./ollama-client");
var import_usage = require("./usage");
var _backend, _ModelManagement_instances, toDevice_fn, onSetLoaded_fn, onDelete_fn, onPull_fn, within_fn, delay_fn;
const PROGRESS_INTERVAL_MS = 1e3;
const GUI_GONE_MS = 15e3;
const SHORT_ACTION_MS = 6e4;
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function tr(key, ...args) {
  const texts = I18n.getTranslatedObject(key, "%s");
  return Object.fromEntries(
    Object.entries(texts).map(([lang, text]) => [
      lang,
      args.reduce((result, arg) => result.replace("%s", String(arg)), text)
    ])
  );
}
function describeDays(days) {
  if (days === 0) {
    return tr("dm_today");
  }
  return days === 1 ? tr("dm_yesterday") : tr("dm_daysAgo", days);
}
class ModelManagement extends import_dm_utils.DeviceManagement {
  /**
   * @param adapter the adapter, it receives the messages of the GUI
   * @param backend what the device manager needs from the adapter
   */
  constructor(adapter, backend) {
    super(adapter);
    __privateAdd(this, _ModelManagement_instances);
    __privateAdd(this, _backend);
    __privateSet(this, _backend, backend);
  }
  async getInstanceInfo() {
    const info = await super.getInstanceInfo();
    let status;
    try {
      const models = await __privateGet(this, _backend).listModels();
      const total = models.reduce((sum, model) => sum + model.size, 0);
      status = { id: "totalSize", text: tr("dm_totalSize", (0, import_models.formatSize)(total)), tooltip: tr("dm_totalSizeHint") };
    } catch {
      status = { id: "notReachable", text: tr("dm_notReachable"), color: "error" };
    }
    return {
      ...info,
      actions: [
        {
          id: "pull",
          icon: "add",
          title: tr("dm_download"),
          description: tr("dm_downloadHint"),
          handler: (context) => __privateMethod(this, _ModelManagement_instances, onPull_fn).call(this, context)
        }
      ],
      indicators: [status]
    };
  }
  async loadDevices(context) {
    let models;
    try {
      models = await __privateGet(this, _backend).listModels();
    } catch (error) {
      this.log.debug(`Cannot list the models for the device manager: ${errorText(error)}`);
      models = [];
    }
    context.setTotalDevices(models.length);
    const now = Date.now();
    for (const model of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
      context.addDevice(__privateMethod(this, _ModelManagement_instances, toDevice_fn).call(this, model, now));
    }
  }
}
_backend = new WeakMap();
_ModelManagement_instances = new WeakSet();
/**
 * The card of a model
 *
 * @param model the model
 * @param now current time in ms
 */
toDevice_fn = function(model, now) {
  const settings = __privateGet(this, _backend).getSettings();
  const isDefault = !!settings.defaultModel && (0, import_models.sameModel)(settings.defaultModel, model.name);
  const channelId = __privateGet(this, _backend).getChannelId(model.name);
  const lastUsed = __privateGet(this, _backend).getLastUsed(model.name);
  const size = (0, import_models.formatSize)(model.size);
  const items = {
    size: { type: "staticInfo", label: tr("dm_size"), data: size, xs: 12, sm: 12, md: 12, lg: 12, xl: 12 },
    lastUsed: {
      type: "staticInfo",
      label: tr("dm_lastUsed"),
      data: lastUsed === void 0 ? "-" : describeDays((0, import_usage.daysSince)(lastUsed, now)),
      xs: 12,
      sm: 12,
      md: 12,
      lg: 12,
      xl: 12
    }
  };
  if (settings.deleteUnusedDays > 0) {
    const left = settings.deleteUnusedDays - (lastUsed === void 0 ? 0 : (0, import_usage.daysSince)(lastUsed, now));
    items.autoDelete = {
      type: "staticInfo",
      label: tr("dm_autoDelete"),
      data: isDefault ? tr("dm_autoDeleteNever") : left > 0 ? tr("dm_autoDeleteIn", left) : tr("dm_autoDeleteSoon"),
      xs: 12,
      sm: 12,
      md: 12,
      lg: 12,
      xl: 12
    };
  }
  const indicators = [];
  if (channelId) {
    indicators.push({
      id: "loaded",
      value: { stateId: `${channelId}.loaded` },
      icon: "play",
      color: "ok",
      tooltip: tr("dm_loaded")
    });
  }
  if (isDefault) {
    indicators.push({ id: "default", text: tr("dm_default"), color: "primary", tooltip: tr("dm_defaultHint") });
  }
  return {
    id: model.name,
    name: model.name,
    icon: "adapter/ai-server/ai-server.png",
    model: [model.parameterSize, model.quantization].filter(Boolean).join(" \xB7 "),
    indicators,
    customInfo: { id: model.name, schema: { type: "panel", items } },
    actions: [
      {
        id: "load",
        icon: "play",
        description: tr("dm_load"),
        // loading a large model from a slow disk takes a while
        timeout: settings.requestTimeoutMs + 5e3,
        handler: (name, context) => __privateMethod(this, _ModelManagement_instances, onSetLoaded_fn).call(this, name, true, context)
      },
      {
        id: "unload",
        icon: "stop",
        description: tr("dm_unload"),
        timeout: SHORT_ACTION_MS,
        handler: (name, context) => __privateMethod(this, _ModelManagement_instances, onSetLoaded_fn).call(this, name, false, context)
      },
      {
        id: "delete",
        icon: "delete",
        description: tr("dm_delete"),
        confirmation: isDefault ? tr("dm_deleteConfirmDefault", model.name, size) : tr("dm_deleteConfirm", model.name, size),
        timeout: SHORT_ACTION_MS,
        handler: (name, context) => __privateMethod(this, _ModelManagement_instances, onDelete_fn).call(this, name, context)
      }
    ]
  };
};
onSetLoaded_fn = async function(name, load, context) {
  try {
    await __privateGet(this, _backend).setLoaded(name, load);
  } catch (error) {
    await context.showMessage(tr("dm_failed", errorText(error)));
    return { refresh: "none" };
  }
  return { refresh: load ? "devices" : "none" };
};
onDelete_fn = async function(name, context) {
  try {
    await __privateGet(this, _backend).deleteModel(name);
  } catch (error) {
    await context.showMessage(tr("dm_failed", errorText(error)));
    return { refresh: "none" };
  }
  return { refresh: "all" };
};
onPull_fn = async function(context) {
  const installed = await __privateGet(this, _backend).listModels().catch(() => []);
  const options = import_models.RECOMMENDED_MODELS.filter(
    (model2) => !installed.some((item) => (0, import_models.sameModel)(item.name, model2.name))
  ).map((model2) => ({
    value: model2.name,
    label: `${model2.name} (${(0, import_models.formatSize)(model2.size)})`,
    noTranslation: true
  }));
  const data = await context.showForm(
    {
      type: "panel",
      items: {
        model: {
          type: "autocomplete",
          label: tr("dm_modelName"),
          help: tr("dm_modelHelp"),
          freeSolo: true,
          options,
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12
        }
      }
    },
    { data: { model: "" }, title: tr("dm_downloadTitle"), maxWidth: "sm", applyDisabledRule: "!data.model" }
  );
  const model = typeof (data == null ? void 0 : data.model) === "string" ? data.model.trim() : "";
  if (!model) {
    return { refresh: false };
  }
  if (!(0, import_ollama_client.isValidModelName)(model)) {
    await context.showMessage(tr("dm_invalidName", model));
    return { refresh: false };
  }
  let percent = 0;
  let status = "";
  let finished = false;
  let failure = null;
  const download = __privateGet(this, _backend).pull(model, (newPercent, newStatus) => {
    percent = newPercent != null ? newPercent : percent;
    status = newStatus;
  }).catch((error) => {
    failure = error;
  }).finally(() => {
    finished = true;
  });
  const progress = await context.openProgress(tr("dm_downloading", model), { value: 0, label: "0 %" });
  while (!finished) {
    const label = status && !status.startsWith("pulling") ? `${percent} % \xB7 ${status}` : `${percent} %`;
    if (!await __privateMethod(this, _ModelManagement_instances, within_fn).call(this, progress.update({ value: percent, label }), GUI_GONE_MS)) {
      await download;
      return { refresh: true };
    }
    await __privateMethod(this, _ModelManagement_instances, delay_fn).call(this, PROGRESS_INTERVAL_MS, () => finished);
  }
  await progress.close();
  if (failure) {
    await context.showMessage(tr("dm_downloadFailed", model, errorText(failure)));
    return { refresh: false };
  }
  return { refresh: true };
};
within_fn = async function(promise, ms) {
  let settled = false;
  const done = () => {
    settled = true;
  };
  await Promise.race([promise.then(done, done), __privateMethod(this, _ModelManagement_instances, delay_fn).call(this, ms, () => settled)]);
  return settled;
};
/**
 * Wait with the timers of the adapter, so that they end on unload
 *
 * @param ms time to wait
 * @param done stops waiting early when it returns true, checked every 100 ms
 */
delay_fn = function(ms, done) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      if (done() || Date.now() >= end || !this.adapter.setTimeout(check, 100)) {
        resolve();
      }
    };
    check();
  });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ModelManagement
});
//# sourceMappingURL=device-management.js.map
