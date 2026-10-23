import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager"

import registerAutoRetitleExtension from "../../src/extension.js"
import { retitleSession } from "../../src/retitling/session-retitler.js"

export function createAccountingSession() {
  const sessionManager = SessionManager.inMemory("/workspace/accounting")
  sessionManager.appendMessage({
    role: "user",
    content: "Build accounting import",
    timestamp: 0,
  })
  return sessionManager
}

export function getDefaultTitlePolicy() {
  return {
    systemPrompt: "Default test title prompt",
    format: "{prefix}{description}{suffix}",
    custom: false,
    path: "default test prompt",
  }
}

export function retitleWithDefaultPolicy(event, extensionContext, options = {}, reason = "command") {
  return retitleSession(event, extensionContext, {
    resolveTitlePolicy: getDefaultTitlePolicy,
    ...options,
  }, reason)
}

export function createExtensionHarness(generateTitle, resolveTitlePolicy = getDefaultTitlePolicy) {
  const handlers = new Map()
  const commands = new Map()
  const notifications = []
  const pi = {
    setLabel() {},
    on(name, callback) {
      handlers.set(name, callback)
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
  }
  registerAutoRetitleExtension(pi, { generateTitle, resolveTitlePolicy })

  return {
    handlers,
    commands,
    notifications,
    createContext(sessionManager) {
      return {
        sessionManager,
        ui: {
          notify: (...args) => notifications.push(args),
        },
      }
    },
  }
}
