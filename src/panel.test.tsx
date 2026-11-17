import { assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { WorkflowDetail, WorkflowItem, Workspace } from './protocol'

const capabilities = ['workspace:read']
const working: Workspace = { id: 'first', name: 'App 1', project: 'App 1', branch: 'main' }
const another: Workspace = { id: 'second', name: 'App 2', project: 'App 2', branch: 'main' }
const notifications: WorkflowItem = { id: 'notifications', title: 'Notification settings', completed: 2, total: 5 }
const search: WorkflowItem = { id: 'search', title: 'Search filters', completed: 0, total: 3 }
const notificationDetail: WorkflowDetail = {
  item: notifications,
  artifacts: [{ id: 'proposal', title: 'Proposal', path: 'openspec/changes/notifications/proposal.md', state: 'done' }],
  canValidate: true,
  canLaunch: true
}

function entry(view: TestPanel, title: string) {
  const match = view.findAll({ type: 'ListItem' }).find((item) => item.props.title === title)
  assert.ok(match, `Missing list item ${title}`)
  return match
}

test('requires a workspace choice when focus cannot identify one and targets its selected change', async () => {
  const calls: unknown[] = []
  const view = await mount(panel, {
    host: mockHost({
      capabilities,
      requests: {
        'workflows.workspaces': () => ({ workspaces: [working, another], suggestedId: null }),
        'workflows.list': ({ workspaceId }) => {
          calls.push({ workspaceId })
          return { items: [notifications, search] }
        },
        'workflows.inspect': ({ workspaceId, itemId }) => {
          calls.push({ workspaceId, itemId })
          return itemId === search.id ? { ...notificationDetail, item: search, artifacts: [] } : notificationDetail
        },
        'workflows.open': (input) => {
          calls.push(input)
          return { opened: true }
        },
        'workflows.validate': (input) => {
          calls.push(input)
          return { valid: false, messages: ['Missing acceptance scenario'] }
        },
        'workflows.launch': (input) => {
          calls.push(input)
          return { terminalId: 'agent-terminal' }
        }
      }
    })
  })

  try {
    assert.match(view.summary().join('\n'), /Select a workspace/)
    assert.deepEqual(calls, [])
    await view.select({ label: 'Workspace' }, working.id)
    assert.match(view.summary().join('\n'), /Notification settings/)
    assert.ok(view.find({ text: '2/5' }))

    await view.press(entry(view, 'Proposal'))
    await view.press({ text: 'Validate' })
    assert.match(view.summary().join('\n'), /OpenSpec validation found problems/)
    assert.ok(view.find({ text: 'Missing acceptance scenario' }))

    await view.press(entry(view, 'Search filters'))
    assert.ok(view.find({ text: '0/3' }))
    assert.equal(view.find({ text: 'Missing acceptance scenario' }), null)
    await view.select({ label: 'Agent' }, 'claude')
    await view.press({ text: 'Start with agent' })
    assert.match(view.summary().join('\n'), /Agent started in this workspace/)
    assert.deepEqual(calls, [
      { workspaceId: working.id },
      { workspaceId: working.id, itemId: notifications.id },
      { workspaceId: working.id, itemId: notifications.id, artifactId: 'proposal' },
      { workspaceId: working.id, itemId: notifications.id },
      { workspaceId: working.id, itemId: search.id },
      { workspaceId: working.id, itemId: search.id, agent: 'claude' }
    ])
    assert.deepEqual(view.refusals, [])
    assert.deepEqual(view.warnings, [])
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('keeps the newest change when an older detail request finishes later', async () => {
  let complete!: (detail: WorkflowDetail) => void
  const delayed = new Promise<WorkflowDetail>((resolve) => {
    complete = resolve
  })
  let begin!: () => void
  const started = new Promise<void>((resolve) => {
    begin = resolve
  })
  const view = await mount(panel, {
    host: mockHost({
      capabilities,
      requests: {
        'workflows.workspaces': () => ({ workspaces: [working], suggestedId: working.id }),
        'workflows.list': () => ({ items: [notifications, search] }),
        'workflows.inspect': ({ itemId }) => {
          if (itemId !== search.id) return notificationDetail
          begin()
          return delayed
        }
      }
    })
  })

  try {
    const previous = view.press(entry(view, 'Search filters'))
    await started
    const next = view.press(entry(view, 'Notification settings'))
    complete({ ...notificationDetail, item: search, artifacts: [] })
    await Promise.all([previous, next])
    entry(view, 'Proposal')
    assert.equal(view.find({ text: 'No artifacts found' }), null)
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('continues the selected BMAD story and sends build intent to the current workspace', async () => {
  const story: WorkflowItem = { id: 'story-1', title: 'Persist filters', completed: null, total: null, status: 'ready-for-dev' }
  const calls: unknown[] = []
  const view = await mount(panel, {
    host: mockHost({
      capabilities,
      requests: {
        'workflows.workspaces': () => ({ workspaces: [working, another], suggestedId: working.id }),
        'workflows.list': (input) => {
          calls.push(input)
          return input.provider === 'bmad' ? { items: [story], buildAgents: ['codex'] } : { items: [] }
        },
        'workflows.inspect': (input) => {
          calls.push(input)
          return {
            item: story,
            artifacts: [{ id: 'story', title: 'Story', path: '_bmad-output/stories/story-1.md', state: 'done' }],
            canValidate: false,
            canLaunch: true,
            agents: ['claude']
          }
        },
        'workflows.open': (input) => {
          calls.push(input)
          return { opened: true }
        },
        'workflows.launch': (input) => {
          calls.push(input)
          return { terminalId: 'story-terminal' }
        },
        'workflows.bmadBuild': (input) => {
          calls.push(input)
          return { terminalId: 'build-terminal' }
        }
      }
    })
  })

  try {
    await view.select({ label: 'Method' }, 'bmad')
    await view.select({ label: 'Workspace' }, another.id)
    assert.ok(view.find({ text: 'Ready for development' }))
    assert.equal(view.find({ text: 'Validate' }), null)
    assert.equal(view.valueOf({ label: 'Agent' }), 'claude')
    await view.press(entry(view, 'Story'))
    await view.press({ text: 'Continue story' })

    const quickBuild = view.findAll({ type: 'Collapsible' }).find((element) => element.props.title === 'Build a small change')
    assert.ok(quickBuild)
    await view.toggle(quickBuild)
    assert.equal(view.valueOf({ label: 'Build agent' }), 'codex')
    await view.type({ label: 'Describe the change' }, 'Add a clear-all action')
    await view.press({ text: 'Start BMAD Build' })
    assert.match(view.summary().join('\n'), /Agent started in this workspace/)
    assert.equal(view.valueOf({ label: 'Describe the change' }), '')
    assert.deepEqual(calls, [
      { workspaceId: working.id },
      { workspaceId: working.id, provider: 'bmad' },
      { workspaceId: working.id, itemId: story.id, provider: 'bmad' },
      { workspaceId: another.id, provider: 'bmad' },
      { workspaceId: another.id, itemId: story.id, provider: 'bmad' },
      { workspaceId: another.id, itemId: story.id, provider: 'bmad', artifactId: 'story' },
      { workspaceId: another.id, itemId: story.id, provider: 'bmad', agent: 'claude' },
      { workspaceId: another.id, agent: 'codex', intent: 'Add a clear-all action' }
    ])
    assert.deepEqual(view.refusals, [])
    assert.deepEqual(view.warnings, [])
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})
