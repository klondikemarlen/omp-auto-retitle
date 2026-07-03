import {
  canRetitle,
  generateTitleWithOmp,
  setAutoSessionName,
} from "./omp-adapter.js"
import {
  titleInputFromCompaction,
  titleInputFromSession,
} from "./title-context.js"

export {
  canRetitle,
  generateTitleWithOmp,
  setAutoSessionName,
  titleInputFromCompaction,
  titleInputFromSession,
}

export default function autoRetitleExtension(pi) {
  pi.setLabel("Auto Retitle")

  pi.on("session_compact", async (event, ctx) => {
    await retitleFromCompaction(event, ctx, { pi })
  })
}

export async function retitleFromCompaction(event, ctx, options = {}) {
  const sessionManager = ctx?.sessionManager

  if (!canRetitle(sessionManager)) {
    return false
  }

  const input = titleInputFromSession(event, ctx)
  if (!input) {
    return false
  }

  const generateTitle = options.generateTitle ?? generateTitleWithOmp
  const title = await generateTitle(input, ctx, options.pi)
  if (!title) {
    return false
  }

  return setAutoSessionName(sessionManager, title)
}
