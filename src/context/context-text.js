const MAX_USER_CONTEXT_LENGTH = 120

export function getRecentUniqueText(values, limit) {
  const seen = new Set()
  const result = []

  for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const value = values[index]
    if (seen.has(value)) continue

    seen.add(value)
    result.unshift(value)
  }

  return result
}

export function getMessageText(message) {
  const content = message?.content

  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  const textParts = []
  for (const part of content) {
    if (part?.type === "text" && part.text) {
      textParts.push(part.text)
    }
  }

  return textParts.join(" ")
}

export function normalizeContextText(value, limit = MAX_USER_CONTEXT_LENGTH) {
  if (typeof value !== "string") return ""

  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
}
