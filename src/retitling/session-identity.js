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

  // A title-history entry changes the raw leaf without advancing the conversation.
  const latestConversationEntry = branch.findLast((entry) => entry.type !== "title_change")
  return latestConversationEntry?.id ?? null
}
