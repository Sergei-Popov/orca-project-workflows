import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { inspectOpenSpec, listOpenSpec, openSpecPrompt, validateOpenSpec } from './openspec'

type WorkspaceRow = Awaited<ReturnType<typeof listWorkspaces>>[number]

async function listWorkspaces(orca: OrcaWorkerApi) {
  const { workspaces } = await orca.host.call('workspace.list')
  return workspaces.filter(({ hostId, path }) =>
    (hostId === 'local' || hostId === null) && isAbsolute(path))
}

async function locateWorkspace(orca: OrcaWorkerApi, id: string) {
  const workspace = (await listWorkspaces(orca)).find((entry) => entry.id === id)
  if (!workspace) throw new Error('The selected local workspace is unavailable.')
  const root = await realpath(workspace.path)
  if (!(await stat(root)).isDirectory()) throw new Error('The workspace folder is unavailable.')
  return { root, workspace }
}

async function artifactPath(root: string, path: string | undefined) {
  if (!path || isAbsolute(path)) throw new Error('The artifact file is unavailable.')
  const file = await realpath(resolve(root, path))
  const rel = relative(root, file)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ||
      !(await stat(file)).isFile()) {
    throw new Error('The artifact must be a file inside the selected workspace.')
  }
  return rel
}

function suggestedWorkspace(rows: WorkspaceRow[], focused: {
  branch: string
  displayName: string
} | null) {
  if (!focused) return rows.length === 1 ? rows[0].id : null
  const matches = rows.filter((entry) =>
    (entry.branch ?? '') === focused.branch && entry.name === focused.displayName)
  return matches.length === 1 ? matches[0].id : null
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('workflows.workspaces', async () => {
    const [rows, focused] = await Promise.all([
      listWorkspaces(orca),
      orca.host.call('workspace.readContext')
    ])
    return {
      workspaces: rows.map(({ id, name, project, branch }) => ({
        id, name, project: project ?? null, branch
      })),
      suggestedId: suggestedWorkspace(rows, focused)
    }
  })

  orca.panels.handle('workflows.list', async ({ workspaceId }) => {
    const { root } = await locateWorkspace(orca, workspaceId)
    return listOpenSpec(root)
  })

  orca.panels.handle('workflows.inspect', async ({ workspaceId, itemId }) => {
    const { root } = await locateWorkspace(orca, workspaceId)
    return inspectOpenSpec(root, itemId)
  })

  orca.panels.handle('workflows.open', async ({ workspaceId, itemId, artifactId }) => {
    const { root, workspace } = await locateWorkspace(orca, workspaceId)
    const detail = await inspectOpenSpec(root, itemId)
    const artifact = detail.artifacts.find(({ id }) => id === artifactId)
    const path = await artifactPath(root, artifact?.path)
    return orca.host.call('editor.open', { workspaceId: workspace.id, path })
  })

  orca.panels.handle('workflows.validate', async ({ workspaceId, itemId }) => {
    const { root } = await locateWorkspace(orca, workspaceId)
    return validateOpenSpec(root, itemId)
  })

  orca.panels.handle('workflows.launch', async ({ workspaceId, itemId, agent }) => {
    if (agent !== 'codex' && agent !== 'claude') throw new Error('Unsupported agent.')
    const { root, workspace } = await locateWorkspace(orca, workspaceId)
    const prompt = await openSpecPrompt(root, itemId, agent)
    return orca.host.call('agent.launch', { workspaceId: workspace.id, agent, prompt })
  })
}
