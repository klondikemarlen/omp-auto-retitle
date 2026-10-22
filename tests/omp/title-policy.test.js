import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

const titlePolicyUrl = new URL("../../src/omp/title-policy.js", import.meta.url).href

function resolvePolicyInIsolatedHome(createFiles, action = "resolveTitlePolicy(ctx)") {
  const root = mkdtempSync(path.join(os.tmpdir(), "omp-title-policy-"))
  const home = path.join(root, "home")
  const project = path.join(root, "project")
  mkdirSync(home)
  mkdirSync(project)

  try {
    createFiles({ home, project })
    const source = `
      import * as fs from "node:fs";
      const { resolveTitlePolicy } = await import(${JSON.stringify(titlePolicyUrl)});
      const ctx = { cwd: ${JSON.stringify(project)} };
      const result = ${action.replaceAll("$PROJECT$", JSON.stringify(project))};
      console.log(JSON.stringify(result));
    `
    const child = spawnSync(process.execPath, ["--eval", source], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMP_PROFILE: "",
        PI_PROFILE: "",
        PI_CONFIG_DIR: ".omp",
      },
    })
    assert.equal(child.status, 0, child.stderr || child.error?.message)
    return JSON.parse(child.stdout.trim())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("when project and user title prompts exist, prefer the project prompt", () => {
  // Arrange
  const createPromptFiles = ({ home, project }) => {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true })
    mkdirSync(path.join(project, ".omp"), { recursive: true })
    writeFileSync(path.join(home, ".omp", "agent", "TITLE_SYSTEM.md"), "user prompt")
    writeFileSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), "project prompt")
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles)

  // Assert
  assert.equal(result.systemPrompt, "project prompt")
  assert.equal(result.custom, true)
  assert.equal(result.path.endsWith(path.join(".omp", "TITLE_SYSTEM.md")), true)
})

test("when the selected title override is blank, use the bundled default policy", () => {
  // Arrange
  const createPromptFiles = ({ project }) => {
    mkdirSync(path.join(project, ".omp"), { recursive: true })
    writeFileSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), " \n\t ")
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles)

  // Assert
  assert.equal(result.custom, false)
})

test("when a title prompt file changes, use its updated instructions", () => {
  // Arrange
  const createPromptFiles = ({ project }) => {
    mkdirSync(path.join(project, ".omp"), { recursive: true })
    writeFileSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), "first prompt")
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles, `(() => {
    const first = resolveTitlePolicy(ctx);
    fs.writeFileSync($PROJECT$ + "/.omp/TITLE_SYSTEM.md", "second prompt");
    return [first.systemPrompt, resolveTitlePolicy(ctx).systemPrompt];
  })()`)

  // Assert
  assert.deepEqual(result, ["first prompt", "second prompt"])
})

test("when the selected title prompt is unreadable, propagate its read error", () => {
  // Arrange
  const createPromptFiles = ({ project }) => {
    mkdirSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), { recursive: true })
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles, `(() => {
    try {
      resolveTitlePolicy(ctx);
      return { threw: false };
    } catch (error) {
      return { threw: true, code: error.code };
    }
  })()`)

  // Assert
  assert.deepEqual(result, { threw: true, code: "EISDIR" })
})

test("when only a user title prompt exists, select its instructions", () => {
  // Arrange
  const createPromptFiles = ({ home }) => {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true })
    writeFileSync(path.join(home, ".omp", "agent", "TITLE_SYSTEM.md"), "user prompt")
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles)

  // Assert
  assert.equal(result.systemPrompt, "user prompt")
  assert.equal(result.custom, true)
})

test("when Markdown includes a format, separate the template from model instructions", () => {
  // Arrange
  const createPromptFiles = ({ project }) => {
    mkdirSync(path.join(project, ".omp"), { recursive: true })
    writeFileSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), '---\nformat: "{reference} | {description}"\n---\nDescribe the active task.')
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles)

  // Assert
  assert.equal(result.format, "{reference} | {description}")
  assert.equal(result.systemPrompt, "Describe the active task.")
})

test("when a format uses an unknown field, reject the policy instead of generating a literal placeholder", () => {
  // Arrange
  const createPromptFiles = ({ project }) => {
    mkdirSync(path.join(project, ".omp"), { recursive: true })
    writeFileSync(path.join(project, ".omp", "TITLE_SYSTEM.md"), '---\nformat: "{pullRequest}"\n---\nDescribe the task.')
  }

  // Act
  const result = resolvePolicyInIsolatedHome(createPromptFiles, `(() => {
    try {
      resolveTitlePolicy(ctx);
      return "";
    } catch (error) {
      return error.message;
    }
  })()`)

  // Assert
  assert.match(result, /Unknown title format field/)
})
