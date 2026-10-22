import { readFileSync } from "node:fs"

import { generateSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator"

const packageMetadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

const LOADED_PLUGIN_INFO = Object.freeze({
  version: packageMetadata.version,
  pid: process.pid,
  loadedAt: new Date().toISOString(),
  entry: new URL("../../index.js", import.meta.url).href,
})

const AUTO_TITLE_SOURCE = "auto"
const PLUGIN_TRIGGER_PREFIX = "omp-auto-retitle:"

export function getLoadedPluginInfo() {
  return LOADED_PLUGIN_INFO
}

export function canAutomaticallyRetitle(manager) {
  const source = manager?.titleSource

  return source === undefined || source === AUTO_TITLE_SOURCE
}

export async function writeAutomaticTitle(manager, title, reason) {
  const normalizedTitle = typeof title === "string" ? title.trim() : ""

  if (!normalizedTitle || manager?.getSessionName?.() === normalizedTitle) {
    return false
  }

  if (typeof manager?.setSessionName !== "function") {
    return false
  }

  const trigger = `${PLUGIN_TRIGGER_PREFIX}${reason}`
  const result = await manager.setSessionName(normalizedTitle, AUTO_TITLE_SOURCE, trigger)
  return result !== false
}

export function observeExternalAutomaticTitles(manager, onChange, onError) {
  if (typeof manager?.onSessionNameChanged !== "function") {
    return undefined
  }

  return manager.onSessionNameChanged(async () => {
    try {
      const entries = manager.getEntries?.() ?? []
      const change = entries.findLast((entry) => entry.type === "title_change")
      if (!isExternalAutomaticTitle(change)) {
        return
      }

      await onChange(change)
    } catch (error) {
      onError(error)
    }
  })
}

function isExternalAutomaticTitle(change) {
  if (change?.source !== AUTO_TITLE_SOURCE) {
    return false
  }

  return typeof change.trigger !== "string" || !change.trigger.startsWith(PLUGIN_TRIGGER_PREFIX)
}

export async function generateTitleWithOmp(input, ctx, pi, titlePolicy) {
  const settings = pi?.pi?.settings
  if (!settings) {
    return null
  }

  return generateSessionTitle(
    input,
    ctx.modelRegistry,
    settings,
    ctx.sessionManager?.getSessionId?.(),
    ctx.model,
    undefined,
    titlePolicy.systemPrompt,
  )
}
