import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  DESIGN_CHECKS as DOMAIN_CHECKS,
  DESIGN_SEEDS as DOMAIN_SEEDS,
  DESIGN_SET_ID_PATTERN,
  COMPONENT_ID_PATTERN,
} from '@kintsugi/domain'

import {
  checkDesignDocument,
  designCoverage,
  designFilesFor,
  designIsStale,
  designItemIds,
  DESIGN_CHECKS,
  DESIGN_SEEDS,
  loadDesignSets,
  parseDesignSet,
  parseDesignTemplate,
  ruleCardsOf,
  type DesignContext,
  type DesignSetSource,
} from '../hooks/reader/design.js'

/**
 * The fixtures are shared with `design/scripts/tests/test_design.py`: the two checkers (this one, which the API runs,
 * and `scripts/design_lib.py`, which the member's harness runs) must give the same answers for the same files.
 * UPDATE_DESIGN_FIXTURES=1 rewrites `expected.json` from this implementation; read the diff before committing it.
 */
const DIR = fileURLToPath(new URL('../../design/scripts/tests/fixtures/design/', import.meta.url))
const read = (...parts: string[]): string => readFileSync(join(DIR, ...parts), 'utf8')

function sourcesOf(group: string): DesignSetSource[] {
  return readdirSync(join(DIR, group), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const files = readdirSync(join(DIR, group, entry.name)).filter(name => name.endsWith('.md'))

      return {
        folder: entry.name,
        setText: files.includes('set.md') ? read(group, entry.name, 'set.md') : undefined,
        templates: Object.fromEntries(files.filter(name => name !== 'set.md').map(name => [name, read(group, entry.name, name)])),
      }
    })
}

const cases = JSON.parse(read('cases.json')) as {
  context: DesignContext
  appContext: DesignContext
  unitKinds: string[]
  cases: { file: string; set: string; template: string }[]
  appCases: { file: string; set: string; template: string }[]
}

function actual() {
  const good = loadDesignSets(sourcesOf('sets'), { unitKinds: cases.unitKinds })
  const bad = loadDesignSets(sourcesOf('bad-sets'), { unitKinds: cases.unitKinds })
  const appGood = loadDesignSets(sourcesOf('app-sets'), { unitKinds: cases.unitKinds })
  const appBad = loadDesignSets(sourcesOf('bad-app-sets'), { unitKinds: cases.unitKinds })
  const designs: Record<string, { problems: { code: string; section?: string; message: string }[]; stale: boolean }> = {}
  const appDesigns: typeof designs = {}

  for (const item of cases.cases) {
    const loaded = good.sets.find(candidate => candidate.set.id === item.set)
    const template = loaded?.templates[item.template]

    if (loaded === undefined || template === undefined) throw new Error(`fixture ${item.file}: no template ${item.set}/${item.template}`)

    const text = read('designs', item.file)

    designs[item.file] = {
      problems: checkDesignDocument(template, loaded.set, text, cases.context).map(problem => ({ code: problem.code, ...(problem.section === undefined ? {} : { section: problem.section }), message: problem.message })),
      stale: designIsStale(text, loaded.set),
    }
  }

  for (const item of cases.appCases) {
    const loaded = appGood.sets.find(candidate => candidate.set.id === item.set)
    const template = loaded?.templates[item.template]

    if (loaded === undefined || template === undefined) throw new Error(`fixture ${item.file}: no template ${item.set}/${item.template}`)

    const text = read('designs', item.file)

    appDesigns[item.file] = {
      problems: checkDesignDocument(template, loaded.set, text, cases.appContext).map(problem => ({ code: problem.code, ...(problem.section === undefined ? {} : { section: problem.section }), message: problem.message })),
      stale: designIsStale(text, loaded.set),
    }
  }

  return {
    validate: {
      sets: good.problems,
      'bad-sets': bad.problems,
      'bad-set-ids': bad.sets.map(loaded => loaded.set.id),
      'app-sets': appGood.problems,
      'bad-app-sets': appBad.problems,
      'bad-app-set-ids': appBad.sets.map(loaded => loaded.set.id),
    },
    designs,
    appDesigns,
  }
}

describe('design sets: the shared fixtures', () => {
  test('give the answers recorded in expected.json', () => {
    const got = actual()

    if (process.env.UPDATE_DESIGN_FIXTURES === '1') writeFileSync(join(DIR, 'expected.json'), `${JSON.stringify(got, null, 2)}\n`)

    expect(existsSync(join(DIR, 'expected.json'))).toBe(true)
    expect(got).toEqual(JSON.parse(read('expected.json')))
  })

  test('the starter-shaped sets are valid', () => {
    expect(loadDesignSets(sourcesOf('sets'), { unitKinds: cases.unitKinds }).problems).toEqual([])
  })
})

describe('design sets: scope, reads and instructions (ADR-0050)', () => {
  const arch = (): NonNullable<ReturnType<typeof parseDesignSet>['set']> => {
    const { set, problems } = parseDesignSet(read('app-sets', 'arch', 'set.md'), 'arch')

    expect(problems).toEqual([])

    if (set === undefined) throw new Error('no set')

    return set
  }

  test('a set is for units unless it says application', () => {
    expect(parseDesignSet(read('sets', 'basic', 'set.md'), 'basic').set).toMatchObject({ scope: 'unit', reads: [], instructions: '' })
    expect(arch()).toMatchObject({ scope: 'application', appliesTo: [], needs: [], reads: ['10-applications/{app}/01-legacy/', '02-architecture/'], stage: 'architecture-design' })
  })

  test('the Instructions section is for the designer and leaves the description', () => {
    expect(arch().instructions).toBe('Describe the target in terms of the common components.\nCite the assessment for what the legacy system does today.')
    expect(arch().description).toBe('How the application is built as a whole, written once for the application.')
  })

  test('an application set has files and no unit kind', () => {
    expect(designFilesFor(arch(), null).map(file => file.path)).toEqual(['overview.md'])
    expect(designFilesFor(arch(), 'screen')).toEqual([])
    const unitSet = parseDesignSet(read('sets', 'basic', 'set.md'), 'basic').set

    if (unitSet === undefined) throw new Error('no set')

    expect(designFilesFor(unitSet, null)).toEqual([])
  })

  test('a unit set may need an application set and the items of the application resolve for it', () => {
    const loaded = loadDesignSets(sourcesOf('app-sets'), { unitKinds: cases.unitKinds })

    expect(loaded.problems).toEqual([])
    expect(loaded.sets.map(entry => [entry.set.id, entry.set.scope, entry.set.needs])).toEqual([['arch', 'application', []], ['dbunit', 'unit', ['arch']]])
  })
})

describe('design sets: reading', () => {
  test('a set keeps its identity, its files and the description under the table', () => {
    const { set, problems } = parseDesignSet(read('sets', 'detail', 'set.md'), 'detail')

    expect(problems).toEqual([])
    expect(set).toMatchObject({ id: 'detail', title: 'Detail design', version: 2, appliesTo: ['screen', 'api'], needs: ['basic'], stage: 'detail-design' })
    expect(set?.files).toEqual([
      { path: 'logic.md', template: 'logic.md', required: true, when: [] },
      { path: 'sql.md', template: 'sql.md', required: false, when: ['api'] },
    ])
    expect(set?.description).toContain('How the unit is built.')
  })

  test('which files a unit of a kind needs', () => {
    const set = parseDesignSet(read('sets', 'detail', 'set.md'), 'detail').set
    if (set === undefined) throw new Error('no set')

    expect(designFilesFor(set, 'screen').map(file => file.path)).toEqual(['logic.md'])
    expect(designFilesFor(set, 'api').map(file => file.path)).toEqual(['logic.md', 'sql.md'])
    expect(designFilesFor(set, 'batch')).toEqual([])
  })

  test('a template section is a heading with a directive block, and only that', () => {
    const { template, problems } = parseDesignTemplate(read('sets', 'detail', 'logic.md'))

    expect(problems).toEqual([])
    expect(template.sections.map(section => [section.heading, section.required, section.table?.length])).toEqual([
      ['Business rules', true, 3],
      ['Error handling', true, 3],
      ['Dependencies', false, 2],
    ])
    expect(template.sections[0]?.checks).toEqual([
      { name: 'covers-rules', column: 'Rule' },
      { name: 'refs-resolve', column: 'Function', source: 'basic' },
      { name: 'no-placeholder' },
    ])
  })

  test('the design items of a document are the cells of its ID columns', () => {
    expect(designItemIds('| ID | Function |\n| --- | --- |\n| F-001 | a |\n| TODO | b |\n\n| Rule | x |\n| --- | --- |\n| R-1 | y |\n')).toEqual(['F-001'])
  })
})

describe('design sets: what a unit offers to the checks', () => {
  test('the rules of a unit are the rows of its rules table, else its cards', () => {
    const table = '---\nrules: 2\n---\n# Rules\n\n| ID | Name | Status |\n| --- | --- | --- |\n| RULE-001 | Total | active |\n| RULE-002 | Old | retired |\n| RULE-003 | Rounding | active |\n'
    expect(ruleCardsOf(table)).toEqual([
      { id: 'RULE-001', title: 'Total' },
      { id: 'RULE-003', title: 'Rounding' },
    ])
    expect(ruleCardsOf('# Rules\n\n## Pricing\n\n### RULE-9: Discount\n\nText\n\n### RULE-10: Fee\n')).toEqual([
      { id: 'RULE-9', title: 'Discount' },
      { id: 'RULE-10', title: 'Fee' },
    ])
    expect(ruleCardsOf('no rules here')).toEqual([])
  })

  test('which rules each covers-rules section names, without the cut the problem message makes', () => {
    const { sets } = loadDesignSets(sourcesOf('sets'), { unitKinds: cases.unitKinds })
    const template = sets.find(loaded => loaded.set.id === 'basic')?.templates['overview.md']
    if (template === undefined) throw new Error('no template')

    expect(designCoverage(template, read('designs', 'basic-overview-ok.md'), cases.context.ruleIds)).toEqual([{ section: 'Rule coverage', column: 'Rule', covered: ['R-001', 'R-002', 'R-003'] }])
    expect(designCoverage(template, read('designs', 'basic-overview-todo.md'), cases.context.ruleIds)).toEqual([{ section: 'Rule coverage', column: 'Rule', covered: ['R-001'] }])
    expect(designCoverage(template, read('designs', 'missing-table.md'), cases.context.ruleIds)).toEqual([])
  })
})

describe('design sets: the vocabulary matches @kintsugi/domain', () => {
  test('checks, seeds and id patterns', () => {
    expect([...DESIGN_CHECKS]).toEqual([...DOMAIN_CHECKS])
    expect([...DESIGN_SEEDS]).toEqual([...DOMAIN_SEEDS])
    expect(DESIGN_SET_ID_PATTERN.test('detail')).toBe(true)
    expect(COMPONENT_ID_PATTERN.test('COM-LOG-01')).toBe(true)
  })
})
