import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env, platform } from 'node:process'
import { assert, test } from 'orca/testing'
import { inspectOpenSpec, listOpenSpec, openSpecPrompt, validateOpenSpec } from './openspec'

const id = 'filtered-csv'
const change = `openspec/changes/${id}`

async function withWorktree(run: (root: string, folder: string, bin: string) => Promise<void>) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'open spec-test-'))
  const root = join(temp, 'worktree')
  const folder = join(root, change)
  const bin = join(temp, 'bin')
  const originalPath = env.PATH
  try {
    await mkdir(join(folder, 'specs', 'csv'), { recursive: true })
    await mkdir(bin)
    await writeFile(join(folder, 'proposal.md'), '# Filtered CSV export\n')
    await writeFile(join(folder, 'design.md'), '# Design\n')
    await writeFile(join(folder, 'tasks.md'), '- [X] Add CSV renderer\r\n  1. [~] Pass current filters\r\n- [A](link.md)\r\n')
    await writeFile(join(folder, 'specs', 'csv', 'spec.md'), '# Requirements\n')
    await mkdir(join(root, 'openspec', 'changes', 'archive', '2025-01-01-something'), { recursive: true })
    env.PATH = bin
    await run(root, folder, bin)
  } finally {
    if (originalPath === undefined) delete env.PATH
    else env.PATH = originalPath
    await rm(temp, { recursive: true, force: true })
  }
}

async function installFixture(bin: string, body: string) {
  const executable = join(bin, 'openspec')
  await writeFile(executable, `#!/bin/sh\n${body}`)
  await chmod(executable, 0o755)
}

test('reads local artifacts and progress without executing a worktree binary', async () => {
  await withWorktree(async (root) => {
    if (platform !== 'win32') await installFixture(root, 'printf "%s\\n" "unexpected worktree binary"\n')
    env.PATH = root
    const list = await listOpenSpec(root)
    assert.deepEqual(list.items, [{ id, title: id, completed: 1, total: 2 }])
    assert.equal(list.notice?.kind, 'cli-missing')
    const detail = await inspectOpenSpec(root, id)
    assert.equal(detail.canValidate, false)
    assert.equal(detail.canLaunch, true)
    assert.ok(detail.artifacts.some(artifact => artifact.path === `${change}/specs/csv/spec.md`))
    assert.match(await openSpecPrompt(root, id, 'claude'), /\/opsx:apply/)
    assert.equal((await validateOpenSpec(root, id)).valid, false)
  })
})

test('rejects traversal, archived changes and artifacts symlinked outside the worktree', async () => {
  await withWorktree(async (root, folder, bin) => {
    await assert.rejects(inspectOpenSpec(root, '../other'), /Invalid OpenSpec change ID/)
    await assert.rejects(inspectOpenSpec(root, 'archive'), /Invalid OpenSpec change ID/)
    if (platform === 'win32') return
    await writeFile(join(bin, 'outside.md'), '# Outside the worktree\n')
    await symlink(join(bin, 'outside.md'), join(folder, 'specs', 'csv', 'bad.md'))
    await symlink(folder, join(root, 'openspec', 'changes', 'symlinked'))
    const detail = await inspectOpenSpec(root, id)
    assert.ok(detail.artifacts.every(artifact => !artifact.path?.endsWith('bad.md')))
    assert.deepEqual((await listOpenSpec(root)).items.map(item => item.id), [id])
  })
})

test('uses CLI JSON for custom artifact globs, task progress and nonzero validation reports', async () => {
  if (platform === 'win32') return
  await withWorktree(async (root, folder, bin) => {
    await mkdir(join(folder, 'acceptance'))
    await writeFile(join(folder, 'acceptance', 'user.md'), '# Public criteria\n')
    await writeFile(join(folder, 'acceptance', 'admin.md'), '# Admin criteria\n')
    const status = {
      root: { path: root },
      changeName: id,
      artifacts: [
        { id: 'criteria', outputPath: 'acceptance/**/*.md', status: 'done' },
        { id: 'deferred', outputPath: 'deferred.md', status: 'blocked' },
        { id: 'skipped', outputPath: 'skipped.md', status: 'skipped' },
        { id: 'unsafe', outputPath: '../config.yaml', status: 'done' },
      ],
      applyRequires: ['criteria', 'skipped'],
    }
    const listing = { changes: [{ name: id, completedTasks: 2, totalTasks: 7, status: 'in-progress' }] }
    const apply = { changeName: id, state: 'ready', progress: { complete: 2, total: 7, remaining: 5 } }
    const invalid = {
      items: [{ id, type: 'change', valid: false, issues: [{ level: 'ERROR', path: 'specs', message: 'Missing a scenario.' }] }],
    }
    await installFixture(bin, `
test -f ${change}/proposal.md || exit 9
case "$1" in
  list) printf '%s\\n' '${JSON.stringify(listing)}' ;;
  status) printf '%s\\n' '${JSON.stringify(status)}' ;;
  instructions) printf '%s\\n' '${JSON.stringify(apply)}' ;;
  validate) printf '%s\\n' '${JSON.stringify(invalid)}'; exit 1 ;;
esac
`)
    assert.equal((await listOpenSpec(root)).items[0].total, 7)
    const detail = await inspectOpenSpec(root, id)
    assert.equal(detail.canValidate, true)
    assert.equal(detail.canLaunch, true)
    assert.equal(detail.item.completed, 2)
    assert.deepEqual(detail.artifacts.map(({ id, state }) => [id, state]), [
      ['criteria:acceptance/admin.md', 'done'],
      ['criteria:acceptance/user.md', 'done'],
      ['deferred', 'blocked'],
      ['unsafe', 'missing'],
    ])
    const prompt = await openSpecPrompt(root, id, 'codex')
    assert.match(prompt, /\$openspec-apply-change/)
    assert.ok(prompt.includes(`${change}/acceptance/admin.md`))
    assert.deepEqual(await validateOpenSpec(root, id), { valid: false, messages: ['ERROR (specs) Missing a scenario.'] })
  })
})

test('reports an installed command failure while keeping local artifacts available', async () => {
  if (platform === 'win32') return
  await withWorktree(async (root, _folder, bin) => {
    await installFixture(bin, `printf '%s\\n' 'Unexpected CLI error' >&2\nexit 1\n`)
    const list = await listOpenSpec(root)
    assert.deepEqual(list.notice, { kind: 'cli-error', detail: 'Unexpected CLI error' })
    assert.equal(list.items.length, 1)
    const detail = await inspectOpenSpec(root, id)
    assert.equal(detail.canValidate, false)
    assert.equal(detail.canLaunch, false)
    assert.ok(detail.artifacts.some(artifact => artifact.path === `${change}/proposal.md`))
  })
})
