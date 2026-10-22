import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { CONFIG_DIR_NAME, getConfigAgentDirName, getProjectDir, parseFrontmatter } from "@oh-my-pi/pi-utils"
import { validateTitleFormat } from "../context/title-format.js"

const BUNDLED_TITLE_POLICY_PATH = fileURLToPath(new URL("../../prompts/default-title.md", import.meta.url))
const BUNDLED_TITLE_POLICY = parseTitlePolicy(
  readFileSync(BUNDLED_TITLE_POLICY_PATH, "utf8"),
  BUNDLED_TITLE_POLICY_PATH,
  false,
)
const COMPAT_CONFIG_DIRS = [".claude", ".codex", ".gemini"]

export function resolveTitlePolicy(extensionContext) {
  const cwd = extensionContext?.cwd ?? extensionContext?.sessionManager?.getCwd?.() ?? getProjectDir()
  const overridePath = findTitlePolicyPath(cwd)

  if (!overridePath) {
    return BUNDLED_TITLE_POLICY
  }

  return readTitlePolicy(overridePath)
}

function readTitlePolicy(path) {
  const markdown = readFileSync(path, "utf8")
  if (!markdown.trim()) {
    return BUNDLED_TITLE_POLICY
  }

  return parseTitlePolicy(markdown, path, true)
}

function parseTitlePolicy(markdown, sourcePath, custom) {
  const { frontmatter, body } = parseFrontmatter(markdown, { source: sourcePath, level: "fatal" })
  validateTitleFormat(frontmatter.format, sourcePath)
  const format = frontmatter.format

  if (custom && !format && !body.trim()) {
    return BUNDLED_TITLE_POLICY
  }

  let systemPrompt = body
  if (custom && format && !body.trim()) {
    systemPrompt = BUNDLED_TITLE_POLICY.systemPrompt
  }

  return { systemPrompt, format, custom, path: sourcePath }
}

function findTitlePolicyPath(cwd) {
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
    if (existsSync(path)) {
      return path
    }
  }

  return undefined
}
