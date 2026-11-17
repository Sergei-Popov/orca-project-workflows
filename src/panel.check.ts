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
  }
})
