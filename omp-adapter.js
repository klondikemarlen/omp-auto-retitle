import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { CONFIG_DIR_NAME, getConfigAgentDirName, getProjectDir, parseFrontmatter } from "@oh-my-pi/pi-utils"
import { generateSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator"

const packageMetadata = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

const LOADED_PLUGIN_INFO = Object.freeze({
  version: packageMetadata.version,
  pid: process.pid,
  loadedAt: new Date().toISOString(),
  entry: new URL("./index.js", import.meta.url).href,
})

const AUTO_TITLE_SOURCE = "auto"
const BUNDLED_TITLE_PROMPT_PATH = fileURLToPath(new URL("./title-prompt.md", import.meta.url))
const BUNDLED_TITLE_PROMPT = parseTitlePrompt(readFileSync(BUNDLED_TITLE_PROMPT_PATH, "utf8"), BUNDLED_TITLE_PROMPT_PATH, false)
const COMPAT_CONFIG_DIRS = [".claude", ".codex", ".gemini"]

export function getLoadedPluginInfo() {
  return LOADED_PLUGIN_INFO
}

export function resolveTitlePrompt(ctx) {
  const cwd = ctx?.cwd ?? ctx?.sessionManager?.getCwd?.() ?? getProjectDir()
  const overridePath = findTitlePromptPath(cwd)

  if (!overridePath) {
    return BUNDLED_TITLE_PROMPT
  }

  const systemPrompt = readFileSync(overridePath, "utf8")
  if (!systemPrompt.trim()) {
    return BUNDLED_TITLE_PROMPT
  }

  return parseTitlePrompt(systemPrompt, overridePath, true)
}

function parseTitlePrompt(markdown, path, custom) {
  const { frontmatter, body } = parseFrontmatter(markdown, { source: path, level: "fatal" })
  const format = frontmatter.format
  if (format !== undefined && (typeof format !== "string" || !format.trim())) {
    throw new Error(`Title format must be a nonblank string: ${path}`)
  }
  if (format?.match(/\{(?!repository\}|reference\}|description\}|prefix\})[^{}]+\}/)) {
    throw new Error(`Unknown title format field: ${path}`)
  }
  if (custom && !format && !body.trim()) return BUNDLED_TITLE_PROMPT

  let systemPrompt = body
  if (custom && format && !body.trim()) systemPrompt = BUNDLED_TITLE_PROMPT.systemPrompt

  return { systemPrompt, format, custom, path }
}

function findTitlePromptPath(cwd) {
  const home = homedir()
  // Match OMP's title discovery without importing config.ts, which is not exposed by the compiled host.
  const directories = [
    join(cwd, CONFIG_DIR_NAME),
    ...COMPAT_CONFIG_DIRS.map((directory) => join(cwd, directory)),
    join(home, getConfigAgentDirName()),
    ...COMPAT_CONFIG_DIRS.map((directory) => join(home, directory)),
  ]
  for (const directory of directories) {
    const path = join(directory, "TITLE_SYSTEM.md")
    if (existsSync(path)) return path
  }

  return undefined
}

export function canRetitle(sessionManager) {
  const source = sessionManager?.titleSource

  return source === undefined || source === AUTO_TITLE_SOURCE
}

export async function setAutoSessionName(sessionManager, title, trigger) {
  const normalizedTitle = typeof title === "string" ? title.trim() : ""

  if (!normalizedTitle || sessionManager?.getSessionName?.() === normalizedTitle) {
    return false
  }

  if (typeof sessionManager?.setSessionName !== "function") {
    return false
  }

  const result = await sessionManager.setSessionName(normalizedTitle, AUTO_TITLE_SOURCE, trigger)
  return result !== false
}

export function subscribeToSessionTitles(sessionManager, callback, onError) {
  if (typeof sessionManager?.onSessionNameChanged !== "function") {
    return undefined
  }

  return sessionManager.onSessionNameChanged(async () => {
    try {
      const entries = sessionManager.getEntries?.() ?? []
      const change = entries.findLast((entry) => entry.type === "title_change")
      if (change) {
        await callback(change)
      }
    } catch (error) {
      onError(error)
    }
  })
}

export async function generateTitleWithOmp(input, ctx, pi, titlePrompt = resolveTitlePrompt(ctx)) {
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
    titlePrompt.systemPrompt,
  )
}
