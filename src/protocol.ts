export type AgentKind = 'codex' | 'claude'
export type WorkflowProvider = 'openspec' | 'bmad'

export interface Workspace {
  id: string
  name: string
  project: string | null
  branch: string | null
}

export interface WorkflowItem {
  id: string
  title: string
  subtitle?: string
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

export type Notice = {
  kind: 'cli-missing' | 'cli-error' | 'unsupported' | 'bmad-missing' | 'bmad-unsupported' | 'bmad-config'
  detail?: string
}

export interface WorkflowDetail {
  item: WorkflowItem
  artifacts: WorkflowArtifact[]
  notice?: Notice
  canValidate: boolean
  canLaunch: boolean
  agents?: AgentKind[]
}

export interface ValidationResult {
  valid: boolean
  messages: string[]
}

type WorkflowLocation = { workspaceId: string; provider?: WorkflowProvider }
type WorkflowSelection = WorkflowLocation & { itemId: string }

declare module 'orca' {
  interface PluginRequests {
    'workflows.workspaces': { output: { workspaces: Workspace[]; suggestedId: string | null } }
    'workflows.list': {
      input: WorkflowLocation
      output: { items: WorkflowItem[]; notice?: Notice; buildAgents?: AgentKind[] }
    }
    'workflows.inspect': {
      input: WorkflowSelection
      output: WorkflowDetail
    }
    'workflows.open': {
      input: WorkflowSelection & { artifactId: string }
      output: { opened: boolean }
    }
    'workflows.validate': {
      input: { workspaceId: string; itemId: string }
      output: ValidationResult
    }
    'workflows.launch': {
      input: WorkflowSelection & { agent: AgentKind }
      output: { terminalId: string }
    }
    'workflows.bmadBuild': {
      input: { workspaceId: string; agent: AgentKind; intent: string }
      output: { terminalId: string }
    }
  }
}
