const passiveEntryTypes = new Set([
  "title_change",
  "model_usage",
  "custom",
])

export function getTaskIdentity(titleContext) {
  return JSON.stringify([
    titleContext.repository,
    titleContext.reference,
    titleContext.originalTask,
  ])
}

export function getConversationLeafId(sessionManager) {
  const branch = sessionManager.getBranch?.()
  if (!branch) return sessionManager.getLeafId?.()

  // Skip known audit and state records; other entries may change context.
  const latestConversationEntry = branch.findLast((entry) => !passiveEntryTypes.has(entry.type))
  return latestConversationEntry?.id ?? null
}
