import { isAppName } from './text.js'

/**
 * The document-repository locations of one application (ADR-0042) and the workspace namespaces
 * beside them, as the portal reader resolves them. Every path the reader touches is built here.
 */
export type WorkspaceLayout = {
  /** The document repository namespace holding one `applications/<app>` folder per application. */
  applicationsDir: string
  sourceDir: string
  targetDir: string
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  applicationsDir: 'applications',
  sourceDir: 'source',
  targetDir: 'target',
}

/** The names a path segment accepts; a folder named like `_example.example` is a sample, never an app, module or unit. */
export const isPathSegment = (value: string): boolean => isAppName(value) && !value.includes('.')

const segment = (value: string, label: string): string => {
  if (!isPathSegment(value)) {
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

const applicationPath = (app: string, layout: WorkspaceLayout): string =>
  `${prefix(layout.applicationsDir, 'applications directory')}/${segment(app, 'app')}`

/** The app's assessment artifacts (topology, delta catalog, baseline, preflight, assessment) are committed here. */
export const assessmentPath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${applicationPath(app, layout)}/assessment`

/** The app's generated aggregates (business rules, security findings, verification report). */
export const generatedPath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${applicationPath(app, layout)}/generated`

/** The app's target picture, the modernization brief among it. */
export const toBePath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${applicationPath(app, layout)}/to-be`

/** The app's unit folders, one `<module>/<unit>` per unit of work. */
export const unitsPath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${applicationPath(app, layout)}/units`

/** A module's authored documents (playbook, spec, notes). */
export const modulePath = (app: string, module: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${unitsPath(app, layout)}/${segment(module, 'module')}`

/** One unit of work's evidence. */
export const unitPath = (app: string, module: string, unit: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${modulePath(app, module, layout)}/${segment(unit, 'unit')}`

/** What the understanding context knows about one unit of work: its AS-IS specification, rules, findings, trace. */
export const understandingPath = (app: string, module: string, unit: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${unitPath(app, module, unit, layout)}/understanding`

/** The human rule verdicts of one unit of work. */
export const rulesReviewPath = (app: string, module: string, unit: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${understandingPath(app, module, unit, layout)}/rules-review.md`

/** Golden fixtures are versioned per unit of work in the document repository. */
export const goldenPath = (app: string, module: string, unit: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${unitPath(app, module, unit, layout)}/verify/golden`

/** A run is an ephemeral equivalence result, keyed by unit of work and run id. */
export const runPath = (app: string, module: string, unit: string, runId: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${unitPath(app, module, unit, layout)}/verify/runs/${segment(runId, 'run id')}`

/** The reader maps this namespace to the source repository at its pinned revision; it is read-only. */
export const sourcePath = (app: string, layout = DEFAULT_WORKSPACE_LAYOUT): string =>
  `${prefix(layout.sourceDir, 'source directory')}/${segment(app, 'app')}`

/** Each target track has a distinct working tree, all owned by the target repository adapter. */
export const targetPath = (app: string, track: 'transform' | 'uplift' | 'reimagine' = 'transform', layout = DEFAULT_WORKSPACE_LAYOUT): string => {
  const suffix = track === 'transform' ? '' : `-${track}`
  return `${prefix(layout.targetDir, 'target directory')}/${segment(app, 'app')}${suffix}`
}

/** Source repositories are inputs only; this module deliberately exposes no write operation. */
export const SOURCE_REPOSITORY_ACCESS = 'read-only' as const
