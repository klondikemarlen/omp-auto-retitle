const AUTO_TITLE_SOURCE = "auto"
const RETITLE_TRIGGER = "omp-auto-retitle:session_compact"

export function canRetitle(sessionManager) {
  const source = sessionManager?.titleSource

  return source === undefined || source === AUTO_TITLE_SOURCE
}

export async function setAutoSessionName(sessionManager, title) {
  if (sessionManager?.getSessionName?.() === title) {
    return false
  }

  if (typeof sessionManager?.setSessionName !== "function") {
    return false
  }

  const result = await sessionManager.setSessionName(title, AUTO_TITLE_SOURCE, RETITLE_TRIGGER)
  return result !== false
}

export async function generateTitleWithOmp(input, ctx, pi) {
  const settings = pi?.pi?.settings
  if (!settings) {
    return null
  }

  const { generateSessionTitle } = await import("@oh-my-pi/pi-coding-agent/utils/title-generator")
  return generateSessionTitle(
    input,
    ctx.modelRegistry,
    settings,
    ctx.sessionManager?.getSessionId?.(),
    ctx.model,
  )
}
