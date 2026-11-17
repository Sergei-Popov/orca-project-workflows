export type AgentKind = 'codex' | 'claude'

export interface Workspace {
  id: string
  name: string
  project: string | null
  branch: string | null
}

export interface WorkflowItem {
  id: string
  title: string
  completed: number | null
  total: number | null
  status?: string
}

export interface WorkflowArtifact {
  id: string
  title: string
  path?: string
  state: 'done' | 'ready' | 'blocked' | 'missing'
}

export type Notice = { kind: 'cli-missing' | 'cli-error' | 'unsupported'; detail?: string }

export interface WorkflowDetail {
  item: WorkflowItem
  artifacts: WorkflowArtifact[]
  notice?: Notice
  canValidate: boolean
  canLaunch: boolean
}

export interface ValidationResult {
  valid: boolean
  messages: string[]
}

declare module 'orca' {
  interface PluginRequests {
    'workflows.workspaces': { output: { workspaces: Workspace[]; suggestedId: string | null } }
    'workflows.list': {
      input: { workspaceId: string }
      output: { items: WorkflowItem[]; notice?: Notice }
    }
    'workflows.inspect': {
      input: { workspaceId: string; itemId: string }
      output: WorkflowDetail
    }
    'workflows.open': {
      input: { workspaceId: string; itemId: string; artifactId: string }
      output: { opened: boolean }
    }
    'workflows.validate': {
      input: { workspaceId: string; itemId: string }
      output: ValidationResult
    }
    'workflows.launch': {
      input: { workspaceId: string; itemId: string; agent: AgentKind }
      output: { terminalId: string }
    }
  }
}
