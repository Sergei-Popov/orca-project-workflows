import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const change = 'filtered-csv'
const proposal = `openspec/changes/${change}/proposal.md`

async function writeChange(root: string, title: string, task: string) {
  const directory = join(root, 'openspec', 'changes', change)
  await mkdir(join(directory, 'specs', 'csv'), { recursive: true })
  await writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n')
  await writeFile(join(directory, 'proposal.md'), `# ${title}\n\nDescribe the change.\n`)
  await writeFile(join(directory, 'design.md'), '# Design\n')
  await writeFile(join(directory, 'tasks.md'), `## Tasks\n\n- [ ] ${task}\n`)
  await writeFile(join(directory, 'specs', 'csv', 'spec.md'), '# CSV export\n')
}

test('opens and hands off the selected workspace when two changes share an id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflows-test-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  await writeChange(first, 'First export', 'First task')
  await writeChange(second, 'Second export', 'Second task')
  const host = mockHost({
    results: {
      'workspace.list': {
        workspaces: [
          { id: 'one', kind: 'worktree', project: 'First', name: 'csv', path: first, branch: 'csv', hostId: 'local' },
          { id: 'two', kind: 'worktree', project: 'Second', name: 'csv', path: second, branch: 'csv', hostId: 'local' },
          { id: 'remote', kind: 'worktree', name: 'ssh', path: second, branch: 'csv', hostId: 'ssh:example' }
        ],
        truncated: false
      },
      'workspace.readContext': { displayName: 'csv', branch: 'csv', terminals: [] },
      'editor.open': { opened: true },
      'agent.launch': { terminalId: 'terminal-two' }
    }
  })
  const worker = await mountWorker(main, { host })

  try {
    const available = await worker.request('workflows.workspaces')
    assert.deepEqual(available.workspaces.map(({ id }) => id), ['one', 'two'])
    assert.equal(available.suggestedId, null)

    const selection = { workspaceId: 'two', itemId: change }
    const detail = await worker.request('workflows.inspect', selection)
    const artifact = detail.artifacts.find(({ path }) => path === proposal)
    assert.ok(artifact)
    assert.deepEqual(await worker.request('workflows.open', { ...selection, artifactId: artifact.id }), { opened: true })
    assert.deepEqual(await worker.request('workflows.launch', { ...selection, agent: 'codex' }), { terminalId: 'terminal-two' })
    const opened = host.calls.find(({ method }) => method === 'editor.open')
    assert.deepEqual(opened?.params, { workspaceId: 'two', path: proposal })
    const launched = host.calls.find(({ method }) => method === 'agent.launch')?.params as {
      workspaceId: string
      agent: string
      prompt: string
    }
    assert.equal(launched.workspaceId, 'two')
    assert.equal(launched.agent, 'codex')
    assert.ok(launched.prompt.includes(change))
    assert.ok(launched.prompt.includes(proposal))
    assert.deepEqual(worker.refusals, [])
  } finally {
    await worker.deactivate()
    await rm(root, { recursive: true, force: true })
  }
})
