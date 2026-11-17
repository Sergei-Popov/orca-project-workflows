import { defineCheck } from 'orca/testing'
import type { WorkflowDetail, WorkflowItem, Workspace } from './protocol'

const working: Workspace = {
  id: 'settings-workspace',
  name: 'Notification settings',
  project: 'Example App',
  branch: 'feature/notification-settings'
}

const another: Workspace = {
  id: 'search-workspace',
  name: 'Search filters',
  project: 'Example App',
  branch: 'feature/search-filters'
}

const notifications: WorkflowItem = {
  id: 'notification-settings',
  title: 'Notification settings',
  completed: 2,
  total: 5
}

const search: WorkflowItem = {
  id: 'search-filters',
  title: 'Search filters',
  completed: 0,
  total: 3
}

const notificationDetail: WorkflowDetail = {
  item: notifications,
  artifacts: [
    { id: 'proposal', title: 'Proposal', path: 'openspec/changes/notification-settings/proposal.md', state: 'done' },
    { id: 'design', title: 'Design', path: 'openspec/changes/notification-settings/design.md', state: 'done' },
    { id: 'tasks', title: 'Tasks', path: 'openspec/changes/notification-settings/tasks.md', state: 'done' },
    { id: 'specs', title: 'Specs', state: 'ready' }
  ],
  canValidate: true,
  canLaunch: true
}

const capabilities = ['workspace:read']
const story: WorkflowItem = {
  id: '1-2-persist-filters',
  title: 'Persist filters on page refresh',
  completed: null,
  total: null,
  status: 'ready-for-dev'
}

export default defineCheck({
  changes: {
    capabilities,
    requests: {
      'workflows.workspaces': () => ({ workspaces: [working, another], suggestedId: working.id }),
      'workflows.list': () => ({ items: [notifications, search] }),
      'workflows.inspect': () => notificationDetail
    }
  },
  'choose-workspace': {
    capabilities,
    requests: {
      'workflows.workspaces': () => ({ workspaces: [working, another], suggestedId: null })
    }
  },
  'no-workspace': {
    capabilities,
    requests: {
      'workflows.workspaces': () => ({ workspaces: [], suggestedId: null })
    }
  },
  'no-cli': {
    capabilities,
    requests: {
      'workflows.workspaces': () => ({ workspaces: [working], suggestedId: working.id }),
      'workflows.list': () => ({ items: [], notice: { kind: 'cli-missing' } })
    }
  },
  'bmad-story': {
    capabilities,
    persisted: { plugin: { method: 'bmad' } },
    requests: {
      'workflows.workspaces': () => ({ workspaces: [another], suggestedId: another.id }),
      'workflows.list': () => ({ items: [story], buildAgents: ['codex', 'claude'] }),
      'workflows.inspect': () => ({
        item: story,
        artifacts: [{
          id: 'story',
          title: 'Story',
          path: '_bmad-output/implementation-artifacts/1-2-persist-filters.md',
          state: 'done'
        }],
        canValidate: false,
        canLaunch: true,
        agents: ['codex', 'claude']
      })
    }
  },
  'bmad-quick-build': {
    capabilities,
    persisted: { plugin: { method: 'bmad' } },
    requests: {
      'workflows.workspaces': () => ({ workspaces: [another], suggestedId: another.id }),
      'workflows.list': () => ({ items: [], buildAgents: ['codex'] })
    }
  }
})
