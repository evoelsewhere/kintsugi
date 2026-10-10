import { isAppName } from './text'

/** Workspace-repository artifact locations understood by the portal reader. */
export type WorkspaceLayout = {
  assessmentDir: string
  sourceDir: string
  targetDir: string
  goldenDir: string
  runsDir: string
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  assessmentDir: 'assessment',
  sourceDir: 'source',
  targetDir: 'target',
  goldenDir: 'golden',
  runsDir: 'runs',
}

const segment = (value: string, label: string): string => {
  if (!isAppName(value) || value.includes('.')) {
    throw new Error(`${label} must be one safe path segment`)
  }

  return value
}

const prefix = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)) {
    throw new Error(`${label} must be a safe relative namespace`)
  }

  return value
}

/** Assessment artifacts are committed in the workspace repository. */
export const assessmentPath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${prefix(layout.assessmentDir, 'assessment directory')}/${segment(app, 'app')}`

/** The reader maps this namespace to the source repository at its pinned revision; it is read-only. */
export const sourcePath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${prefix(layout.sourceDir, 'source directory')}/${segment(app, 'app')}`

/** Each target track has a distinct working tree, all owned by the target repository adapter. */
export const targetPath = (app: string, track: 'transform' | 'uplift' | 'reimagine' = 'transform', layout = DEFAULT_WORKSPACE_LAYOUT): string => {
  const suffix = track === 'transform' ? '' : `-${track}`
  return `${prefix(layout.targetDir, 'target directory')}/${segment(app, 'app')}${suffix}`
}

/** Golden fixtures are versioned per unit in the workspace repository. */
export const goldenPath = (unit: string, layout = DEFAULT_WORKSPACE_LAYOUT): string => {
  return `${prefix(layout.goldenDir, 'golden directory')}/${segment(unit, 'unit')}`
}

/** A run is an ephemeral equivalence result, keyed by unit and run id. */
export const runPath = (unit: string, runId: string, layout = DEFAULT_WORKSPACE_LAYOUT): string => {
  return `${prefix(layout.runsDir, 'runs directory')}/${segment(unit, 'unit')}/${segment(runId, 'run id')}`
}

/** Source repositories are inputs only; this module deliberately exposes no write operation. */
export const SOURCE_REPOSITORY_ACCESS = 'read-only' as const
