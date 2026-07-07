import { generateSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator"

const AUTO_TITLE_SOURCE = "auto"
const RETITLE_TRIGGER = "omp-auto-retitle:session_compact"

export function canRetitle(sessionManager) {
  const source = sessionManager?.titleSource

  return source === undefined || source === AUTO_TITLE_SOURCE
}

export async function setAutoSessionName(sessionManager, title) {
  const normalizedTitle = typeof title === "string" ? title.trim() : ""

  if (!normalizedTitle || sessionManager?.getSessionName?.() === normalizedTitle) {
    return false
  }

  if (typeof sessionManager?.setSessionName !== "function") {
    return false
  }

  const result = await sessionManager.setSessionName(normalizedTitle, AUTO_TITLE_SOURCE, RETITLE_TRIGGER)
  return result !== false
}

export async function generateTitleWithOmp(input, ctx, pi) {
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
  )
}
