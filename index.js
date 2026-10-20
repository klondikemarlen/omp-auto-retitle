import {
  canRetitle,
  generateTitleWithOmp,
  setAutoSessionName,
} from "./omp-adapter.js"
import { titleContextFromSession, titleWithIdentity } from "./title-context.js"

const pendingRetitles = new WeakMap()

export default function autoRetitleExtension(pi, options = {}) {
  pi.setLabel("Auto Retitle")

  pi.on("session_compact", async (event, ctx) => {
    await retitleFromCompaction(event, ctx, { ...options, pi })
  })

  pi.registerCommand("retitle", {
    description: "Regenerate the auto title from repository, ticket or PR, and session task.",
    handler: async (_args, ctx) => {
      const changed = await retitleFromCompaction({}, ctx, { ...options, pi })
      ctx.ui?.notify?.(changed ? "Session title regenerated" : "Session title unchanged", "info")
    },
  })
}

export async function retitleFromCompaction(event, ctx, options = {}) {
  const sessionManager = ctx?.sessionManager

  if (!sessionManager || !canRetitle(sessionManager)) {
    return false
  }

  const context = titleContextFromSession(event, ctx)
  if (!context) {
    return false
  }

  const request = {
    sessionId: sessionManager.getSessionId?.(),
    leafId: sessionManager.getLeafId?.(),
  }
  pendingRetitles.set(sessionManager, request)

  try {
    const generateTitle = options.generateTitle ?? generateTitleWithOmp
    const description = await generateTitle(context.input, ctx, options.pi)
    const title = titleWithIdentity(description, context)

    if (
      !title ||
      pendingRetitles.get(sessionManager) !== request ||
      sessionManager.getSessionId?.() !== request.sessionId ||
      sessionManager.getLeafId?.() !== request.leafId ||
      !canRetitle(sessionManager)
    ) {
      return false
    }

    return await setAutoSessionName(sessionManager, title)
  } finally {
    if (pendingRetitles.get(sessionManager) === request) {
      pendingRetitles.delete(sessionManager)
    }
  }
}
