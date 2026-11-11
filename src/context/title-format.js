export function formatSessionTitle(description, titleContext, format) {
  const text = typeof description === "string" ? description.trim() : ""
  if (!text) return ""
  if (!format) return text

  const values = {
    repository: titleContext.repository ?? "",
    reference: titleContext.reference ?? "",
    description: text,
    prefix: titleContext.reference ? `${titleContext.reference}: ` : "",
    suffix: titleContext.repository ? ` — ${titleContext.repository}` : "",
  }

  return format.replace(/\{(repository|reference|description|prefix|suffix)\}/g, (_match, field) => values[field])
    .replace(/\s+/g, " ").trim()
}

export function getRequestTitleExcerpt(titleContext) {
  // A new ticket without a subject must not inherit the original ticket's task.
  if (titleContext.reference) return ""

  const request = titleContext.originalTask?.trim() ?? ""
  if (!request || /^[{[<]|^https?:\/\//i.test(request)) return ""
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|continue|go ahead)[.! ]*$/i.test(request)) return ""
  if (request.length <= 120) return request

  const prefix = request.slice(0, 119)
  const boundary = prefix.lastIndexOf(" ")
  return `${boundary > 0 ? prefix.slice(0, boundary) : prefix}…`
}

export function validateTitleFormat(format, sourcePath) {
  if (format !== undefined && (typeof format !== "string" || !format.trim())) {
    throw new Error(`Title format must be a nonblank string: ${sourcePath}`)
  }
  if (format?.match(/\{(?!repository\}|reference\}|description\}|prefix\}|suffix\})[^{}]+\}/)) {
    throw new Error(`Unknown title format field: ${sourcePath}`)
  }
}
