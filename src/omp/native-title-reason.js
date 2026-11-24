import { AsyncLocalStorage } from "node:async_hooks"

const activeRequest = new AsyncLocalStorage()
const nativeReasons = new Set([
  "aborted", "exception", "invalid-title", "local-no-output", "low-signal",
  "missing-api-key", "model-returned-none", "no-title-model", "provider-response-error",
])

export function isNativeTitleReason(reason) {
  return nativeReasons.has(reason)
}

// Native and plugin requests can share both a model and a session. Match the
// async invocation, not the session ID or the timing of a process-wide log.
export async function observeNativeTitleReason(logger, signal, onReason, generate) {
  if (!onReason || !logger?.registerLogSink || signal?.aborted) return generate()

  const owner = Symbol()
  const unsubscribe = logger.registerLogSink((event) => {
    if (activeRequest.getStore() !== owner || !event.message.startsWith("title-generator: ")) return

    const reason = event.context?.reason
    if (isNativeTitleReason(reason)) onReason(reason)
  })
  // A host that ignores cancellation may never settle. Release the sink when
  // the plugin stops waiting, even if the host's promise is still pending.
  signal?.addEventListener("abort", unsubscribe, { once: true })
  try {
    return await activeRequest.run(owner, generate)
  } finally {
    signal?.removeEventListener("abort", unsubscribe)
    unsubscribe()
  }
}
