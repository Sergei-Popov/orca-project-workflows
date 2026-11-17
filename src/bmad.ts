import { Buffer } from 'node:buffer'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseToml } from '../vendor/toml/toml.mjs'
import { parseDocument } from '../vendor/yaml/yaml.mjs'
import type { AgentKind, Notice, WorkflowArtifact, WorkflowDetail, WorkflowItem } from './protocol'

type Table = Record<string, unknown>

interface Project {
  root: string
  specs: string
  planning: string
  implementation: string
  agents: AgentKind[]
}

interface Story {
  item: WorkflowItem
  artifacts: WorkflowArtifact[]
  key: string
  specFolder?: string
  storyFile?: string
  source: string
  canLaunch: boolean
  specCheckpoint?: boolean
}

const VERSION = '6.12.4'
const MANIFEST = '_bmad/_config/manifest.yaml'
const BASE_CONFIG = '_bmad/config.toml'
const CONFIG_LAYERS = [BASE_CONFIG, '_bmad/config.user.toml', '_bmad/custom/config.toml', '_bmad/custom/config.user.toml']
const BUILD_RENDERER = '_bmad/scripts/render_skill.py'
const PROVIDER_SKILLS = [
  { id: 'codex', tool: 'codex', path: '.agents/skills/bmad-build/SKILL.md' },
  { id: 'claude', tool: 'claude-code', path: '.claude/skills/bmad-build/SKILL.md' },
] as const
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 4_000
const MAX_STORIES = 1_000
const MAX_INTENT = 2_000
const SPEC_STATES = new Set(['draft', 'ready-for-dev', 'in-progress', 'in-review', 'done'])
const SPRINT_BUILD_STATES = new Set(['backlog', 'ready-for-dev', 'in-progress', 'review'])
const STORY_ID = /^[a-zA-Z\d]+(?:-[a-zA-Z\d]+)*$/
const SPRINT_KEY = /^(\d+)-(\d+)-([a-zA-Z\d]+(?:-[a-zA-Z\d]+)*)$/

function table(value: unknown): Table | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Table : undefined
}

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function inProject(root: string, path: string): boolean {
  const name = relative(root, path)
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

// Check existing ancestors too. An unsafe symlink is still unsafe when its target file is absent.
async function localPath(root: string, path: string) {
  if (!inProject(root, path)) throw new Error('Expected a path inside the selected worktree.')
  let current = root
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info) return undefined
    if (info.isSymbolicLink()) throw new Error('BMad files must reside inside the selected worktree.')
    if (current === path) return info
  }
  return lstat(root)
}

async function readLocal(root: string, path: string): Promise<string | undefined> {
  const info = await localPath(root, path)
  if (!info) return undefined
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error('Expected a readable BMad file of at most 1 MiB.')
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(info.size + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size !== info.size) throw new Error('The BMad file changed while it was being read.')
    return buffer.toString('utf8', 0, size)
  } finally {
    await file.close()
  }
}

function yaml(source: string): unknown {
  const document = parseDocument(source, { strict: true, uniqueKeys: true, stringKeys: true })
  if (document.errors.length) throw new Error('Invalid BMad YAML.')
  return document.toJS({ maxAliasCount: 0 })
}

async function configPaths(root: string): Promise<Pick<Project, 'specs' | 'planning' | 'implementation'>> {
  // Resolve the three scalar paths from BMAD's four central layers in precedence order.
  let core: Table | undefined
  let bmm: Table | undefined
  for (const layer of CONFIG_LAYERS) {
    const source = await readLocal(root, join(root, layer))
    if (source === undefined) {
      if (layer === BASE_CONFIG) throw new Error('Missing BMad configuration.')
      continue
    }
    const config = parseToml(source, { maxDepth: 40 })
    if (Object.hasOwn(config, 'core')) {
      const next = table(config.core)
      core = next ? { ...core, ...next } : undefined
    }
    if (!Object.hasOwn(config, 'modules')) continue
    const modules = table(config.modules)
    if (!modules) bmm = undefined
    else if (Object.hasOwn(modules, 'bmm')) {
      const next = table(modules.bmm)
      bmm = next ? { ...bmm, ...next } : undefined
    }
  }
  async function configuredDirectory(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Missing BMad artifact path.')
    if (/[{}]/.test(value.replaceAll('{project-root}', '')) || value.startsWith('~')) throw new Error('Invalid BMad artifact path.')
    const configured = value.replaceAll('{project-root}', root)
    const path = resolve(root, configured)
    const info = await localPath(root, path)
    if (info && !info.isDirectory()) throw new Error('BMad artifact paths must be directories.')
    return path
  }
  const [output, planning, implementation] = await Promise.all([
    configuredDirectory(core?.output_folder),
    configuredDirectory(bmm?.planning_artifacts),
    configuredDirectory(bmm?.implementation_artifacts),
  ])
  const specs = join(output, 'specs')
  const specsInfo = await localPath(root, specs)
  if (specsInfo && !specsInfo.isDirectory()) throw new Error('Expected the BMad specs directory.')
  return { specs, planning, implementation }
}

function frontmatter(source: string): Table | undefined {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  return match ? table(yaml(match[1])) : undefined
}

async function hasBuildSkill(root: string, path: string): Promise<boolean> {
  try {
    const source = await readLocal(root, join(root, path))
    return source !== undefined && frontmatter(source)?.name === 'bmad-build'
  } catch {
    return false
  }
}

async function loadProject(worktree: string): Promise<{ project: Project } | { notice: Notice }> {
  if (!isAbsolute(worktree)) return { notice: { kind: 'bmad-missing' } }
  const root = await realpath(worktree).catch(() => undefined)
  if (!root) return { notice: { kind: 'bmad-missing' } }
  try {
    const source = await readLocal(root, join(root, MANIFEST))
    if (source === undefined) return { notice: { kind: 'bmad-missing' } }
    const manifest = table(yaml(source))
    const modules = manifest?.modules
    const version = table(manifest?.installation)?.version
    const bmm = Array.isArray(modules) && modules.map(table).find(module => module?.name === 'bmm')
    if (version !== VERSION || !bmm || bmm.version !== VERSION) {
      return { notice: { kind: 'bmad-unsupported', detail: `Expected BMad Method ${VERSION} with the BMM module.` } }
    }
    const paths = await configPaths(root)
    const tools = Array.isArray(manifest?.ides) ? manifest.ides : []
    const agents: AgentKind[] = []
    if ((await localPath(root, join(root, BUILD_RENDERER)))?.isFile()) {
      for (const skill of PROVIDER_SKILLS) {
        const workflow = join(root, dirname(skill.path), 'workflow.md')
        if (tools.includes(skill.tool) && await hasBuildSkill(root, skill.path) && (await localPath(root, workflow))?.isFile()) {
          agents.push(skill.id)
        }
      }
    }
    return { project: { root, ...paths, agents } }
  } catch {
    return { notice: { kind: 'bmad-config', detail: 'Check the BMad manifest and TOML artifact paths in this worktree.' } }
  }
}

function artifact(id: string, title: string, path?: string): WorkflowArtifact {
  return { id, title, ...(path !== undefined ? { path } : {}), state: path ? 'done' : 'missing' }
}

async function childFiles(root: string, directory: string, predicate: (name: string) => boolean): Promise<string[]> {
  if (!(await localPath(root, directory))?.isDirectory()) return []
  const paths: string[] = []
  let count = 0
  for await (const entry of await opendir(directory)) {
    if (++count > MAX_TREE_ENTRIES) throw new Error('Too many files in a BMad artifact directory.')
    if (entry.isFile() && predicate(entry.name)) paths.push(join(directory, entry.name))
  }
  return paths.sort()
}

async function planningFiles(root: string, planning: string): Promise<string[]> {
  if (!(await localPath(root, planning))?.isDirectory()) return []
  const files: string[] = []
  const pending = [planning]
  let visited = 0
  while (pending.length) {
    const directory = pending.pop()!
    for await (const entry of await opendir(directory)) {
      if (++visited > MAX_TREE_ENTRIES) throw new Error('Too many files in the BMad planning directory.')
      const path = join(directory, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') pending.push(path)
      if (entry.isFile() && (entry.name === 'stories.yaml' || /^epics?(-\d+)?\.md$/i.test(entry.name))) files.push(path)
    }
  }
  return files.sort()
}

async function specStatus(root: string, file: string): Promise<string | undefined> {
  const content = await readLocal(root, file)
  const status = content === undefined ? undefined : frontmatter(content)?.status
  return typeof status === 'string' && SPEC_STATES.has(status) ? status : undefined
}

async function specStories(root: string, storiesFile: string): Promise<Story[]> {
  const folder = dirname(storiesFile)
  const specFile = join(folder, 'SPEC.md')
  if (!(await localPath(root, specFile))?.isFile()) return []
  const source = await readLocal(root, storiesFile)
  if (source === undefined) return []
  const rows = yaml(source)
  if (!Array.isArray(rows) || rows.length > MAX_STORIES) throw new Error('Invalid BMad story list.')
  const storyFiles = await childFiles(root, join(folder, 'stories'), name => name.endsWith('.md'))
  const keys = new Set<string>()
  for (const row of rows) {
    const data = table(row)
    const key = data?.id
    if (typeof key !== 'string' || key.length > 120 || !STORY_ID.test(key) || keys.has(key) ||
      typeof data?.title !== 'string' || !data.title.trim() || /[\r\n]/.test(data.title) ||
      typeof data.description !== 'string' || !data.description.trim() || Object.hasOwn(data, 'status')) {
      throw new Error('Invalid BMad story list.')
    }
    keys.add(key)
  }
  for (const key of keys) {
    const segments = key.split('-')
    if (segments.slice(1).some((_part, index) => keys.has(segments.slice(0, index + 1).join('-')))) {
      throw new Error('Ambiguous BMad story IDs.')
    }
  }
  const path = portable(root, storiesFile)
  const stories: Story[] = []
  for (const data of rows as Array<{ id: string; title: string; spec_checkpoint?: boolean }>) {
    const key = data.id
    const matches = storyFiles.filter(file => basename(file).startsWith(`${key}-`))
    const file = matches.length === 1 ? matches[0] : undefined
    const storyFile = file ? portable(root, file) : undefined
    const status = file ? await specStatus(root, file) : undefined
    stories.push({
      item: { id: `spec:${encodeURIComponent(path)}:${key}`, title: data.title.trim(), subtitle: `${basename(folder)} · ${key}`,
        completed: null, total: null, ...(status ? { status } : {}) },
      artifacts: [artifact('spec', 'SPEC.md', portable(root, specFile)), artifact('stories', 'stories.yaml', path), artifact('story', 'Story', storyFile)],
      key, source: path, specFolder: portable(root, folder) || '.', storyFile,
      canLaunch: matches.length <= 1 && status !== 'done',
      specCheckpoint: data.spec_checkpoint === true,
    })
  }
  return stories
}

async function sprintStories(project: Project, plans: string[]): Promise<Story[]> {
  const { root, implementation } = project
  const path = join(implementation, 'sprint-status.yaml')
  const source = await readLocal(root, path)
  if (source === undefined) return []
  const data = table(yaml(source))
  const states = table(data?.development_status)
  if (!states) throw new Error('Invalid BMad sprint status.')
  const entries = Object.entries(states)
  if (entries.length > MAX_STORIES) throw new Error('Too many BMad sprint stories.')
  const storyFiles = await childFiles(root, implementation, name => name.endsWith('.md'))
  const result: Story[] = []
  const sprint = portable(root, path)
  for (const [key, status] of entries) {
    const match = SPRINT_KEY.exec(key)
    if (!match || key.length > 160 || typeof status !== 'string' || !/^[a-z][a-z-]{0,40}$/.test(status)) continue
    const [, epic, number, slug] = match
    const matches = storyFiles.filter(file => basename(file) === `${key}.md` || basename(file) === `spec-${key}.md`)
    const file = matches.length === 1 ? matches[0] : undefined
    const story = file ? portable(root, file) : undefined
    const storyState = file ? await specStatus(root, file) : undefined
    const epicFiles = plans.filter(file => basename(file).toLowerCase() === `epic-${epic}.md`)
    const epicSource = epicFiles.length === 1 ? epicFiles[0] : undefined
    const epics = plans.filter(file => basename(file).toLowerCase() === 'epics.md')
    const plan = epicSource ?? (epics.length === 1 ? epics[0] : undefined)
    result.push({
      item: {
        id: `sprint:${encodeURIComponent(sprint)}:${key}`,
        title: `${epic}-${number} ${slug.replaceAll('-', ' ')}`,
        completed: null, total: null, status,
      },
      artifacts: [artifact('sprint', 'sprint-status.yaml', sprint), artifact('epic', 'Epic', plan && portable(root, plan)), artifact('story', 'Story', story)],
      key, source: sprint, storyFile: story,
      canLaunch: matches.length <= 1 && (story !== undefined || plan !== undefined)
        && SPRINT_BUILD_STATES.has(status) && storyState !== 'done' && (status !== 'review' || storyState === 'in-review'),
    })
  }
  return result
}

async function readStories(project: Project): Promise<{ stories: Story[]; notice?: Notice }> {
  let plans: string[] = []
  let notice: Notice | undefined
  const stories: Story[] = []
  try {
    const [specs, planning] = await Promise.all([
      planningFiles(project.root, project.specs),
      planningFiles(project.root, project.planning),
    ])
    plans = planning
    const storyLists = new Set([...specs, ...planning].filter(path => basename(path) === 'stories.yaml'))
    for (const file of storyLists) {
      try {
        stories.push(...await specStories(project.root, file))
        if (stories.length > MAX_STORIES) {
          stories.length = MAX_STORIES
          throw new Error('Too many BMad planning stories.')
        }
      } catch {
        notice = { kind: 'bmad-config', detail: 'Some BMad planning stories could not be read.' }
        if (stories.length >= MAX_STORIES) break
      }
    }
  } catch {
    notice = { kind: 'bmad-config', detail: 'The BMad planning directory could not be indexed.' }
  }
  try {
    stories.push(...await sprintStories(project, plans))
  } catch {
    notice = { kind: 'bmad-config', detail: 'The BMad sprint status could not be read.' }
  }
  return { stories, ...(notice ? { notice } : {}) }
}

export async function listBmad(root: string): Promise<{ items: WorkflowItem[]; notice?: Notice; buildAgents?: AgentKind[] }> {
  const result = await loadProject(root)
  if ('notice' in result) return { items: [], notice: result.notice }
  const { stories, notice } = await readStories(result.project)
  return { items: stories.map(story => story.item), buildAgents: result.project.agents, ...(notice ? { notice } : {}) }
}

async function findStory(root: string, id: string) {
  const result = await loadProject(root)
  if ('notice' in result) throw new Error('BMad Method is unavailable in the selected worktree.')
  const { stories, notice } = await readStories(result.project)
  const story = stories.find(candidate => candidate.item.id === id)
  if (!story) throw new Error('The BMad story is no longer available in the selected worktree.')
  return { story, agents: result.project.agents, notice }
}

export async function inspectBmad(root: string, id: string): Promise<WorkflowDetail> {
  const { story, agents, notice } = await findStory(root, id)
  return { item: story.item, artifacts: story.artifacts, canValidate: false,
    canLaunch: story.canLaunch && agents.length > 0, agents, ...(notice ? { notice } : {}) }
}

function buildStart(agent: AgentKind): string {
  return `Use the ${agent === 'codex' ? '$bmad-build' : '/bmad-build'} skill in this worktree and follow its review checkpoints.`
}

const BUILD_REVIEW = 'Show the implementation and verification results for review before committing. Leave pushing and pull request creation for a separate user request.'

export async function bmadPrompt(root: string, id: string, agent: AgentKind): Promise<string> {
  const { story, agents } = await findStory(root, id)
  if (!story.canLaunch || !agents.includes(agent)) throw new Error('BMad Build cannot launch for this story and agent.')
  const { key, specFolder, source, storyFile } = story
  const target = specFolder !== undefined
    ? `Build story ID ${JSON.stringify(key)} in the spec folder ${JSON.stringify(specFolder)}. Read its parent SPEC.md and entry in ${JSON.stringify(source)}.`
    : `Build sprint story ${JSON.stringify(key)} tracked in ${JSON.stringify(source)}.`
  return [
    buildStart(agent), target,
    ...(storyFile ? [`Use its existing story file ${JSON.stringify(storyFile)}.`] : []),
    ...(!specFolder ? story.artifacts.filter(entry => entry.id === 'epic' && entry.path).map(entry => `Read the related epic ${JSON.stringify(entry.path)}.`) : []),
    ...(story.specCheckpoint ? ['Pause once the story spec is ready and ask for review before implementing it.'] : []),
    BUILD_REVIEW,
  ].join('\n')
}

export async function bmadQuickBuildPrompt(root: string, intent: string, agent: AgentKind): Promise<string> {
  if (typeof intent !== 'string' || !intent.trim() || intent.length > MAX_INTENT) {
    throw new Error(`Enter a BMad Build request of 1–${MAX_INTENT} characters.`)
  }
  const result = await loadProject(root)
  if ('notice' in result || !result.project.agents.includes(agent)) throw new Error('BMad Build is unavailable for this agent in the selected worktree.')
  return [buildStart(agent), BUILD_REVIEW, '', intent.trim()].join('\n')
}
