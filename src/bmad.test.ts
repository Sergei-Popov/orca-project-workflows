import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { platform } from 'node:process'
import { assert, test } from 'orca/testing'
import { bmadPrompt, bmadQuickBuildPrompt, inspectBmad, listBmad } from './bmad'

async function write(root: string, path: string, text: string) {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'bmad-workflows-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function install(root: string, version = '6.12.4') {
  await write(root, '_bmad/_config/manifest.yaml', `installation:\n  version: ${version}\nmodules:\n  - name: bmm\n    version: ${version}\nides: [codex, claude-code]\n`)
  await write(root, '_bmad/config.toml', `[core]
output_folder = "_bmad-output"
[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
`)
  await write(root, '_bmad/scripts/render_skill.py', 'raise RuntimeError("The project reader must never execute this file")\n')
  await write(root, '.agents/skills/bmad-build/SKILL.md', '---\nname: bmad-build\n---\n')
  await write(root, '.agents/skills/bmad-build/workflow.md', '# Build\n')
}

async function writeSpec(root: string, folder: string, title: string) {
  await write(root, `${folder}/SPEC.md`, '# Parent spec\n')
  await write(root, `${folder}/stories.yaml`, `- id: "1"\n  title: ${title}\n  description: An acceptance criterion from the parent spec.\n  spec_checkpoint: true\n  invoke_dev_with: "UNTRUSTED_TEXT"\n`)
}

test('layers configured BMAD paths and disambiguates the same story ID in different specs', async () => {
  await fixture(async root => {
    await install(root)
    await write(root, '_bmad/config.user.toml', '[core]\noutput_folder = "base override"\n[modules.bmm]\nimplementation_artifacts = "user/sprint"\n')
    await write(root, '_bmad/custom/config.toml', '[core]\noutput_folder = "team override"\n[modules.bmm]\nplanning_artifacts = "team plans"\n')
    await write(root, '_bmad/custom/config.user.toml', 'core.output_folder = "workflow output"\nmodules.bmm.implementation_artifacts = "{project-root}/user progress"\n')
    await writeSpec(root, 'workflow output/specs/spec-csv', 'Filtered CSV')
    await write(root, 'workflow output/specs/spec-csv/stories/1-export.md', '---\nstatus: in-review\n---\n# Existing story\n')
    await writeSpec(root, 'workflow output/specs/spec-search', 'Search')
    await writeSpec(root, 'team override/specs/spec-ignored', 'Overridden location')
    await write(root, 'team plans/epics.md', '# Epics\n')
    await write(root, 'user progress/sprint-status.yaml', 'development_status:\n  epic-1: in-progress\n  1-2-record-audit-events: ready-for-dev\n  epic-1-retrospective: optional\n')
    await write(root, 'user progress/spec-1-2-record-audit-events.md', '---\nstatus: ready-for-dev\n---\n# Sprint story spec\n')

    const list = await listBmad(root)
    assert.equal(list.notice, undefined)
    assert.deepEqual(list.buildAgents, ['codex'])
    assert.equal(list.items.length, 3)
    const [csv, search, sprint] = list.items
    assert.notEqual(csv.id, search.id)
    assert.equal(csv.status, 'in-review')
    assert.equal(search.status, undefined)
    assert.equal(sprint.status, 'ready-for-dev')

    const csvDetail = await inspectBmad(root, csv.id)
    assert.deepEqual(csvDetail.artifacts.map(a => a.path), [
      'workflow output/specs/spec-csv/SPEC.md',
      'workflow output/specs/spec-csv/stories.yaml',
      'workflow output/specs/spec-csv/stories/1-export.md',
    ])
    const sprintDetail = await inspectBmad(root, sprint.id)
    assert.deepEqual(sprintDetail.artifacts.map(a => a.path), [
      'user progress/sprint-status.yaml', 'team plans/epics.md', 'user progress/spec-1-2-record-audit-events.md',
    ])
    const prompt = await bmadPrompt(root, search.id, 'codex')
    assert.match(prompt, /\$bmad-build/)
    assert.ok(prompt.includes('"workflow output/specs/spec-search"'))
    assert.match(prompt, /ask for review before implementing/)
    assert.match(prompt, /review before committing/)
    assert.ok(!prompt.includes('UNTRUSTED_TEXT'))
  })
})

test('preserves source sprint states and offers Build only for eligible source and agent', async () => {
  await fixture(async root => {
    await install(root)
    const implementation = '_bmad-output/implementation-artifacts'
    await write(root, `${implementation}/sprint-status.yaml`, 'development_status:\n  1-1-finished: done\n  1-2-review: review\n  1-3-queued: backlog\n')
    await write(root, `${implementation}/1-1-finished.md`, '---\nstatus: done\n---\n')
    await write(root, `${implementation}/spec-1-2-review.md`, '---\nstatus: in-review\n---\n')
    const { items } = await listBmad(root)
    assert.deepEqual(items.map(item => item.status), ['done', 'review', 'backlog'])
    const [done, review, queued] = items
    assert.equal((await inspectBmad(root, done.id)).canLaunch, false)
    assert.equal((await inspectBmad(root, review.id)).canLaunch, true)
    assert.equal((await inspectBmad(root, queued.id)).canLaunch, false)
    await assert.rejects(bmadPrompt(root, done.id, 'codex'), /cannot launch/)
    await assert.rejects(bmadPrompt(root, review.id, 'claude'), /cannot launch/)
    const prompt = await bmadQuickBuildPrompt(root, '  Export filtered reports  ', 'codex')
    assert.match(prompt, /Export filtered reports$/)
    await assert.rejects(bmadQuickBuildPrompt(root, ' ', 'codex'), /Enter a BMad Build request/)
    await assert.rejects(bmadQuickBuildPrompt(root, 'Fix typo', 'claude'), /unavailable/)
  })
})

test('identifies missing or unsupported BMAD installations and rejects escaping paths', async () => {
  await fixture(async root => {
    assert.equal((await listBmad(root)).notice?.kind, 'bmad-missing')
    await install(root, '7.0.0-alpha.2')
    assert.equal((await listBmad(root)).notice?.kind, 'bmad-unsupported')
    await install(root)
    await write(root, '_bmad/custom/config.user.toml', '[modules.bmm]\nimplementation_artifacts = "../outside"\n')
    assert.equal((await listBmad(root)).notice?.kind, 'bmad-config')
    if (platform === 'win32') return
    await symlink(dirname(root), join(root, 'outside'))
    await write(root, '_bmad/custom/config.user.toml', '[modules.bmm]\nimplementation_artifacts = "outside/absent"\n')
    assert.equal((await listBmad(root)).notice?.kind, 'bmad-config')
  })
})

test('keeps independent stories available when a YAML alias is rejected', async () => {
  await fixture(async root => {
    await install(root)
    await writeSpec(root, '_bmad-output/specs/spec-healthy', 'Healthy story')
    await write(root, '_bmad-output/implementation-artifacts/sprint-status.yaml', 'status: &status done\ndevelopment_status:\n  1-1-injected: *status\n')
    const { items, notice } = await listBmad(root)
    assert.deepEqual(items.map(item => item.title), ['Healthy story'])
    assert.equal(notice?.kind, 'bmad-config')
  })
})
