export function formatSessionTitle(description, titleContext, format) {
  const text = typeof description === "string" ? description.trim() : ""
  if (!text) return ""
  if (!format) return text

  const identity = [titleContext.repository, titleContext.reference].filter(Boolean).join(" ")
  const values = {
    repository: titleContext.repository ?? "",
    reference: titleContext.reference ?? "",
    description: text,
    prefix: identity ? `${identity}: ` : "",
  }

  return format.replace(/\{(repository|reference|description|prefix)\}/g, (_match, field) => values[field])
    .replace(/\s+/g, " ").trim()
}

export function validateTitleFormat(format, sourcePath) {
  if (format !== undefined && (typeof format !== "string" || !format.trim())) {
    throw new Error(`Title format must be a nonblank string: ${sourcePath}`)
  }
  if (format?.match(/\{(?!repository\}|reference\}|description\}|prefix\})[^{}]+\}/)) {
    throw new Error(`Unknown title format field: ${sourcePath}`)
  }
}
