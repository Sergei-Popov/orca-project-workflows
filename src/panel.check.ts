import { defineCheck } from 'orca/testing'
import type { WorkflowArtifact, WorkflowDetail, WorkflowItem, Workspace } from './protocol'

const reports: Workspace = {
  id: 'reports', name: 'Reports', project: 'Field Ledger', branch: 'feature/reporting'
}
const filters: Workspace = {
  id: 'filters', name: 'Filters', project: 'Field Ledger', branch: 'feature/filters'
}
const workspaces = () => ({ workspaces: [reports, filters], suggestedId: reports.id })

const change: WorkflowItem = {
  id: 'add-filtered-csv-export', title: 'add-filtered-csv-export', completed: 1, total: 3, status: 'in-progress'
}
const pending: WorkflowItem = {
  id: 'pending-design', title: 'pending-design', completed: 0, total: 0, status: 'no-tasks'
}

function changeFile(id: string, title: string, filename: string): WorkflowArtifact {
  return { id: `${id}:${filename}`, title, path: `openspec/changes/${change.id}/${filename}`, state: 'done' }
}

const changeDetail: WorkflowDetail = {
  item: change,
  artifacts: [
    changeFile('proposal', 'Proposal', 'proposal.md'),
    changeFile('specs', 'Specs', 'specs/csv-export/spec.md'),
    changeFile('design', 'Design', 'design.md'),
    changeFile('tasks', 'Tasks', 'tasks.md')
  ],
  canValidate: true,
  canLaunch: true
}
const pendingDetail: WorkflowDetail = {
  item: pending,
  artifacts: [
    { id: 'proposal', title: 'Proposal', state: 'ready' },
    { id: 'specs', title: 'Specs', state: 'blocked' },
    { id: 'design', title: 'Design', state: 'blocked' },
    { id: 'tasks', title: 'Tasks', state: 'blocked' }
  ],
  canValidate: true,
  canLaunch: false
}
const inspectChange = ({ itemId }: { itemId: string }) => itemId === pending.id ? pendingDetail : changeDetail

const source = 'delivery/sprint-status.yaml'
const sprintItems: WorkflowItem[] = [
  ['1-2-show-report-history', '1-2 show report history', 'review'],
  ['1-3-filter-report-history', '1-3 filter report history', 'ready-for-dev'],
  ['1-1-record-report-exports', '1-1 record report exports', 'done']
].map(([key, title, status]) => ({
  id: `sprint:${encodeURIComponent(source)}:${key}`, title, status, completed: null, total: null
}))

const story: WorkflowItem = {
  id: 'spec:planning%2Fspecs%2Fexport-filters%2Fstories.yaml:1', title: 'Keep the active report filters',
  subtitle: 'export-filters · 1', completed: null, total: null, status: 'in-review'
}
const storyDetail: WorkflowDetail = {
  item: story,
  artifacts: [
    { id: 'spec', title: 'SPEC.md', path: 'planning/specs/export-filters/SPEC.md', state: 'done' },
    { id: 'stories', title: 'stories.yaml', path: 'planning/specs/export-filters/stories.yaml', state: 'done' },
    { id: 'story', title: 'Story', path: 'planning/specs/export-filters/stories/1-keep-filters.md', state: 'done' }
  ],
  canValidate: false, canLaunch: true, agents: ['codex', 'claude']
}

const capabilities = ['workspace:read']
const bmad = { plugin: { method: 'bmad' } }

export default defineCheck({
  changes: {
    capabilities,
    requests: {
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: [change, pending] }),
      'workflows.inspect': inspectChange,
      'workflows.validate': () => ({ valid: true, messages: [] })
    }
  },
  'blocked-change': {
    capabilities,
    requests: {
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: [pending, change] }),
      'workflows.inspect': inspectChange
    }
  },
  'choose-workspace': {
    capabilities,
    requests: {
      'workflows.workspaces': () => ({ workspaces: [reports, filters], suggestedId: null })
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
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: [], notice: { kind: 'cli-missing' } })
    }
  },
  'bmad-story': {
    capabilities, persisted: bmad,
    requests: {
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: [story], buildAgents: ['codex', 'claude'] }),
      'workflows.inspect': () => storyDetail
    }
  },
  'bmad-sprint': {
    capabilities, persisted: bmad,
    requests: {
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: sprintItems, buildAgents: ['codex'] }),
      'workflows.inspect': () => ({
        item: sprintItems[0],
        artifacts: [
          { id: 'sprint', title: 'sprint-status.yaml', path: source, state: 'done' },
          { id: 'epic', title: 'Epic', path: 'planning/epics.md', state: 'done' },
          { id: 'story', title: 'Story', path: 'delivery/spec-1-2-show-report-history.md', state: 'done' }
        ],
        canValidate: false, canLaunch: true, agents: ['codex']
      })
    }
  },
  'bmad-quick-build': {
    capabilities, persisted: bmad,
    requests: {
      'workflows.workspaces': workspaces,
      'workflows.list': () => ({ items: [], buildAgents: ['codex'] })
    }
  }
})
