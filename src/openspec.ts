import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path'
import { env, platform } from 'node:process'
import type { AgentKind, Notice, ValidationResult, WorkflowArtifact, WorkflowDetail, WorkflowItem } from './protocol'

type JsonObject = Record<string, unknown>
type CliResult = { json: JsonObject } | { notice: Notice }

const CHANGES = 'openspec/changes'
const MAX_ARTIFACTS = 500
const MAX_TASK_FILE_BYTES = 512 * 1024
const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[\s*([^\]\s]?)\s*\](?![([])/
const DEFAULT_ARTIFACTS = [
  ['proposal', 'proposal.md'],
  ['specs', 'specs/**/*.md'],
  ['design', 'design.md'],
  ['tasks', 'tasks.md'],
] as const

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function changeId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 200 && id !== 'archive' && /^[a-z\d]+(?:-[a-z\d]+)*$/.test(id)
}

function safeRelative(path: string): boolean {
  return Boolean(path) && !/[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function within(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function localDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined))?.isDirectory() === true
    && await realpath(path).catch(() => undefined) === path
}

async function localRoot(root: string): Promise<string | undefined> {
  if (!isAbsolute(root)) return undefined
  const canonical = await realpath(root).catch(() => undefined)
  if (!canonical || !await localDirectory(join(canonical, 'openspec'))) return undefined
  const [changes, specs] = await Promise.all([
    localDirectory(join(canonical, CHANGES)),
    localDirectory(join(canonical, 'openspec/specs')),
  ])
  return changes || specs ? canonical : undefined
}

async function localChange(root: string, id: string): Promise<{ root: string; folder: string }> {
  if (!changeId(id)) throw new Error('Invalid OpenSpec change ID.')
  const project = await localRoot(root)
  if (!project) throw new Error('This worktree has no local OpenSpec project.')
  const folder = join(project, CHANGES, id)
  if (!await localDirectory(folder)) throw new Error('The OpenSpec change is no longer available in this worktree.')
  return { root: project, folder }
}

async function command(root: string, args: string[], acceptValidationFailure = false): Promise<CliResult> {
  // Resolve outside the selected worktree, including PATH entries reached through symlinks.
  const paths = (env.PATH ?? env.Path ?? '').split(delimiter).filter(path => isAbsolute(path))
  const searchPaths = (await Promise.all(paths.map(path => realpath(path).catch(() => undefined))))
    .filter((path): path is string => path !== undefined && !within(root, path))
  const name = platform === 'win32' ? 'openspec.exe' : 'openspec'
  let executable: string | undefined
  for (const directory of searchPaths) {
    const target = await realpath(join(directory, name)).catch(() => undefined)
    if (!target || within(root, target)) continue
    if (!(await stat(target).catch(() => undefined))?.isFile()) continue
    if (!await access(target, constants.X_OK).then(() => true).catch(() => false)) continue
    executable = target
    break
  }
  if (!executable) return { notice: { kind: 'cli-missing' } }
  const childEnv = { ...env, OPENSPEC_TELEMETRY: '0', OPENSPEC_NO_UPDATE_CHECK: '1', NO_COLOR: '1', CI: '1' }
  for (const key of Object.keys(childEnv)) {
    if (key.toLowerCase() === 'path') delete childEnv[key as keyof typeof childEnv]
  }
  return new Promise(resolveResult => {
    execFile(executable, args, {
      cwd: root,
      env: { ...childEnv, PATH: searchPaths.join(delimiter) },
      timeout: 8_000,
      maxBuffer: 2 * 1024 * 1024,
      killSignal: 'SIGKILL',
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') return resolveResult({ notice: { kind: 'cli-missing' } })
      let json: JsonObject | undefined
      try {
        json = object(JSON.parse(stdout))
      } catch {
        // Old or misconfigured executables can emit text in JSON mode.
      }
      if (!json || (error && !(acceptValidationFailure && typeof error.code === 'number' && Array.isArray(json.items)))) {
        const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
        const fallback = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? 'OpenSpec returned more output than the plugin can read.'
          : error?.killed ? 'OpenSpec timed out.' : 'OpenSpec did not return the expected JSON.'
        return resolveResult({ notice: { kind: 'cli-error', detail: detail || fallback } })
      }
      const reportedRoot = object(json.root)?.path
      if (typeof reportedRoot === 'string' && resolve(reportedRoot) !== root) {
        return resolveResult({ notice: { kind: 'unsupported', detail: 'OpenSpec resolved a project outside this worktree.' } })
      }
      resolveResult({ json })
    })
  })
}

async function localFile(folder: string, path: string): Promise<boolean> {
  if (!safeRelative(path)) return false
  const full = join(folder, path)
  return (await lstat(full).catch(() => undefined))?.isFile() === true
    && await realpath(full).catch(() => undefined) === full
}

async function collectFiles(folder: string): Promise<string[]> {
  const files: string[] = []
  const directories = ['']
  let visited = 0
  while (directories.length && visited < MAX_ARTIFACTS) {
    const directory = directories.pop()!
    const entries = await readdir(join(folder, directory), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (++visited > MAX_ARTIFACTS) break
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (!safeRelative(path) || entry.name.startsWith('.')) continue
      if (entry.isDirectory()) directories.push(path)
      if (entry.isFile()) files.push(path)
    }
  }
  return files.sort()
}

async function taskProgress(folder: string): Promise<Pick<WorkflowItem, 'completed' | 'total'>> {
  if (await localFile(folder, 'tasks.md')) {
    const file = await open(join(folder, 'tasks.md'), 'r').catch(() => undefined)
    if (file) {
      try {
        const { size } = await file.stat()
        if (size <= MAX_TASK_FILE_BYTES) {
          const lines = (await file.readFile('utf8')).split('\n')
          let total = 0
          let completed = 0
          for (const line of lines) {
            const match = TASK_LINE.exec(line)
            if (match) {
              total += 1
              if (match[1].toLowerCase() === 'x') completed += 1
            }
          }
          return { completed, total }
        }
      } catch {
        // The task file can change or be removed while the panel is open.
      } finally {
        await file.close()
      }
    }
  }
  return { completed: null, total: null }
}

function counts(total: unknown, completed: unknown): Pick<WorkflowItem, 'completed' | 'total'> {
  const validCounts = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0
    && typeof completed === 'number' && Number.isSafeInteger(completed) && completed >= 0 && completed <= total
  return { completed: validCounts ? completed : null, total: validCounts ? total : null }
}

function cliChange(entry: unknown): WorkflowItem | undefined {
  const data = object(entry)
  const id = data?.name
  if (!changeId(id) || !data) return undefined
  return {
    id, title: id,
    ...counts(data.totalTasks, data.completedTasks),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
  }
}

export async function listOpenSpec(root: string): Promise<{ items: WorkflowItem[]; notice?: Notice }> {
  const project = await localRoot(root)
  if (!project) return { items: [], notice: { kind: 'unsupported' } }
  const directory = join(project, CHANGES)
  if (!await localDirectory(directory)) return { items: [] }
  const entries = await readdir(directory, { withFileTypes: true })
  const ids = new Set(entries.filter(entry => entry.isDirectory() && changeId(entry.name)).map(entry => entry.name))
  const result = await command(project, ['list', '--changes', '--json'])
  if ('json' in result && Array.isArray(result.json.changes)) {
    const items = result.json.changes.map(cliChange).filter((item): item is WorkflowItem => !!item && ids.has(item.id))
    return { items }
  }
  const items = await Promise.all([...ids].sort().map(async id => ({ id, title: id, ...await taskProgress(join(directory, id)) })))
  const notice: Notice = 'notice' in result ? result.notice : { kind: 'cli-error', detail: 'OpenSpec did not return a change list.' }
  return { items, notice }
}

function artifactsForPaths(id: string, paths: string[], state: WorkflowArtifact['state'], change: string): WorkflowArtifact[] {
  const title = id.replace(/[-_]/g, ' ').replace(/^./, first => first.toUpperCase())
  if (!paths.length) return [{ id, title, state }]
  return paths.map(path => ({
    id: `${id}:${path}`,
    title: paths.length > 1 ? `${title} · ${path}` : title,
    path: `${change}/${path}`,
    state: 'done',
  }))
}

async function statusArtifacts(folder: string, change: string, json: JsonObject): Promise<{ artifacts: WorkflowArtifact[]; canLaunch: boolean } | undefined> {
  if (!Array.isArray(json.artifacts)) return undefined
  let files: Promise<string[]> | undefined
  const outputs = object(json.artifactPaths)
  const artifacts: WorkflowArtifact[] = []
  const satisfied = new Set<string>()
  for (const entry of json.artifacts) {
    const artifact = object(entry)
    const id = artifact?.id
    const state = artifact?.status
    if (!artifact || typeof id !== 'string') return undefined
    if (state === 'skipped') {
      satisfied.add(id)
      continue
    }
    if (state !== 'done' && state !== 'ready' && state !== 'blocked') return undefined
    if (state !== 'done') {
      artifacts.push(...artifactsForPaths(id, [], state, change))
      continue
    }

    const existing = object(outputs?.[id])?.existingOutputPaths
    let candidates: string[] = []
    if (Array.isArray(existing)) {
      candidates = existing.filter((path): path is string => typeof path === 'string' && isAbsolute(path))
        .map(path => relative(folder, path).split(sep).join('/'))
    } else if (typeof artifact.outputPath === 'string') {
      const pattern = artifact.outputPath.split(sep).join('/')
      if (safeRelative(pattern)) {
        candidates = /[*?{[]/.test(pattern)
          ? (await (files ??= collectFiles(folder))).filter(path => matchesGlob(path, pattern))
          : [pattern]
      }
    }
    const paths = []
    for (const path of [...new Set(candidates)].slice(0, MAX_ARTIFACTS)) {
      if (await localFile(folder, path)) paths.push(path)
    }
    if (paths.length) satisfied.add(id)
    artifacts.push(...artifactsForPaths(id, paths, paths.length ? 'done' : 'missing', change))
  }
  const required = Array.isArray(json.applyRequires) ? json.applyRequires : undefined
  const canLaunch = !!required && required.every(id => typeof id === 'string' && satisfied.has(id))
    && artifacts.some(artifact => artifact.path !== undefined)
  return { artifacts, canLaunch }
}

export async function inspectOpenSpec(root: string, id: string): Promise<WorkflowDetail> {
  const local = await localChange(root, id)
  const change = `${CHANGES}/${id}`
  const [result, apply] = await Promise.all([
    command(local.root, ['status', '--change', id, '--json']),
    command(local.root, ['instructions', 'apply', '--change', id, '--json']),
  ])
  const applyInfo = 'json' in apply && apply.json.changeName === id ? apply.json : undefined
  const progress = object(applyInfo?.progress)
  const item = {
    id, title: id,
    ...(!progress ? await taskProgress(local.folder)
      : applyInfo?.taskTrackingConfigured === false ? counts(null, null) : counts(progress.total, progress.complete)),
  }
  if ('json' in result && result.json.changeName === id) {
    const status = await statusArtifacts(local.folder, change, result.json)
    if (status) {
      return {
        item: applyInfo?.state === 'all_done' ? { ...item, status: 'complete' } : item,
        artifacts: status.artifacts,
        canLaunch: status.canLaunch && (applyInfo?.state === 'ready' || applyInfo?.state === 'all_done'),
        canValidate: true,
        ...('notice' in apply ? { notice: apply.notice } : {}),
      }
    }
  }
  const files = await collectFiles(local.folder)
  const artifacts = DEFAULT_ARTIFACTS.flatMap(([artifact, pattern]) => {
    const paths = files.filter(path => matchesGlob(path, pattern))
    return artifactsForPaths(artifact, paths, 'missing', change)
  })
  const notice: Notice = 'notice' in result ? result.notice : { kind: 'cli-error', detail: 'OpenSpec did not return the selected change status.' }
  const canLaunch = notice.kind === 'cli-missing' && files.includes('proposal.md') && files.includes('tasks.md') && (item.total ?? 0) > 0
  const complete = canLaunch && item.completed === item.total
  return { item: complete ? { ...item, status: 'complete' } : item, artifacts, notice, canValidate: false, canLaunch }
}

export async function validateOpenSpec(root: string, id: string): Promise<ValidationResult> {
  const local = await localChange(root, id)
  const result = await command(local.root, ['validate', id, '--type', 'change', '--no-interactive', '--json'], true)
  if ('notice' in result) return { valid: false, messages: [result.notice.detail ?? 'OpenSpec CLI is not available.'] }
  const items = result.json.items
  const report = Array.isArray(items) ? items.map(object).find(item => item?.id === id && item.type === 'change') : undefined
  if (typeof report?.valid !== 'boolean' || !Array.isArray(report.issues)) {
    return { valid: false, messages: ['OpenSpec did not return a validation report for the selected change.'] }
  }
  const messages = report.issues.slice(0, 100).flatMap(issue => {
    const finding = object(issue)
    if (typeof finding?.message !== 'string') return []
    const level = typeof finding.level === 'string' ? finding.level : 'INFO'
    const location = typeof finding.path === 'string' ? ` (${finding.path})` : ''
    return [`${level}${location} ${finding.message}`]
  })
  return { valid: report.valid, messages }
}

export async function openSpecPrompt(root: string, id: string, agent: AgentKind): Promise<string> {
  const detail = await inspectOpenSpec(root, id)
  if (!detail.canLaunch) throw new Error('The OpenSpec change is not ready for implementation.')
  const complete = detail.item.status === 'complete'
  const action = complete ? 'verify' : 'apply'
  const skill = `openspec-${action}-change`
  const workflow = agent === 'codex' ? `$${skill}` : `${skill} skill (/opsx:${action} if enabled)`
  const paths = detail.artifacts.flatMap(artifact => artifact.path ? [`- ${JSON.stringify(artifact.path)}`] : [])
  return [
    `${complete ? 'Verify' : 'Implement'} the OpenSpec change ${JSON.stringify(id)} in this worktree.`,
    `Use the ${workflow} workflow if installed. Start by reading project instructions and these change artifacts:`,
    ...paths,
    complete
      ? 'All tracked tasks are complete. Compare the implementation with the change artifacts, run relevant checks, and report any gaps.'
      : 'Continue from the open implementation tasks within the agreed scope, run relevant checks, and report the result.',
    'Leave commits, pushes, pull requests, and archival for a separate user request.',
  ].join('\n')
}
