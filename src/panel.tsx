import {
  atom,
  Badge,
  Button,
  Callout,
  EmptyState,
  env,
  Heading,
  IconButton,
  List,
  ListItem,
  on,
  plugin,
  Progress,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  update,
  type PanelContext
} from 'orca'
import type {
  AgentKind,
  Notice,
  ValidationResult,
  WorkflowArtifact,
  WorkflowDetail,
  WorkflowItem,
  Workspace
} from './protocol'

const en = {
  workspace: 'Workspace',
  chooseWorkspace: 'Select a workspace',
  emptyWorkspaces: 'No available workspaces',
  refresh: 'Refresh',
  workspacesLoading: 'Loading workspaces',
  listLoading: 'Loading changes',
  detailLoading: 'Loading artifacts',
  changes: 'Changes',
  emptyChanges: 'No OpenSpec changes',
  artifacts: 'Artifacts',
  emptyArtifacts: 'No artifacts found',
  progress: 'Tasks completed',
  check: 'Validate',
  run: 'Start with agent',
  agent: 'Agent',
  actionLoading: 'Working',
  valid: 'OpenSpec validation passed',
  invalid: 'OpenSpec validation found problems',
  launched: 'Agent started in this workspace',
  operationFailed: 'Could not complete the request',
  openFailed: 'Could not open the artifact',
  cliMissing: 'OpenSpec CLI is unavailable',
  cliError: 'OpenSpec CLI returned an error',
  unsupported: 'This workspace is unsupported',
  states: { done: 'Done', ready: 'Ready', blocked: 'Blocked', missing: 'Missing' },
  artifactNames: { proposal: 'Proposal', specs: 'Specifications', design: 'Design', tasks: 'Tasks' }
}
const ru: typeof en = {
  workspace: 'Рабочая область',
  chooseWorkspace: 'Выберите рабочую область',
  emptyWorkspaces: 'Нет доступных рабочих областей',
  refresh: 'Обновить',
  workspacesLoading: 'Загрузка рабочих областей',
  listLoading: 'Загрузка изменений',
  detailLoading: 'Загрузка артефактов',
  changes: 'Изменения',
  emptyChanges: 'Нет изменений OpenSpec',
  artifacts: 'Артефакты',
  emptyArtifacts: 'Артефакты не найдены',
  progress: 'Задач выполнено',
  check: 'Проверить',
  run: 'Запустить агента',
  agent: 'Агент',
  actionLoading: 'Выполняется',
  valid: 'Проверка OpenSpec пройдена',
  invalid: 'Проверка OpenSpec нашла ошибки',
  launched: 'Агент запущен в рабочей области',
  operationFailed: 'Не удалось выполнить запрос',
  openFailed: 'Не удалось открыть артефакт',
  cliMissing: 'OpenSpec CLI недоступен',
  cliError: 'Ошибка OpenSpec CLI',
  unsupported: 'Рабочая область не поддерживается',
  states: { done: 'Готово', ready: 'Можно начать', blocked: 'Заблокировано', missing: 'Отсутствует' },
  artifactNames: { proposal: 'Предложение', specs: 'Спецификации', design: 'Проектирование', tasks: 'Задачи' }
}
type Copy = typeof en

type Loading = 'workspaces' | 'items' | 'detail'
type Action = 'open' | 'validate' | 'launch'

interface PanelState {
  workspaces: Workspace[]
  workspaceId: string
  items: WorkflowItem[]
  itemId: string
  detail: WorkflowDetail | null
  agent: AgentKind
  loading: Loading | null
  acting: boolean
  notice: Notice | null
  error: string | null
  validation: ValidationResult | null
  launched: boolean
}

const state = atom<PanelState>({
  workspaces: [],
  workspaceId: '',
  items: [],
  itemId: '',
  detail: null,
  agent: 'codex',
  loading: 'workspaces',
  acting: false,
  notice: null,
  error: null,
  validation: null,
  launched: false
})

interface Run {
  lookup?: AbortController
  action?: AbortController
  focused?: string | null
}
const run = atom<Run | null>(null)

function patch(fields: Partial<PanelState>): void {
  update(state, (previous) => ({ ...previous, ...fields }))
}

function strings(): Copy {
  return env.locale.toLowerCase().split('-')[0] === 'ru' ? ru : en
}

function startLookup(current: Run, loading: Loading, fields: Partial<PanelState>): AbortSignal {
  current.lookup?.abort()
  current.action?.abort()
  current.lookup = new AbortController()
  patch({ ...fields, loading, error: null, acting: false, validation: null, launched: false })
  return current.lookup.signal
}

function showError(error: unknown, signal: AbortSignal): void {
  if (signal.aborted) return
  patch({ error: error instanceof Error ? error.message : String(error), loading: null, acting: false })
}

async function refresh(preferFocus = false): Promise<void> {
  const current = read(run)
  if (!current) return
  const { workspaceId, itemId } = read(state)
  const signal = startLookup(current, 'workspaces', { notice: null, detail: null })
  try {
    const { workspaces, suggestedId } = await plugin.request('workflows.workspaces', undefined, { signal })
    if (signal.aborted) return
    const preserved = workspaces.some((entry) => entry.id === workspaceId) ? workspaceId : ''
    const suggested = workspaces.find((entry) => entry.id === suggestedId)?.id ?? ''
    const target = (preferFocus ? suggested : preserved || suggested) || (workspaces.length === 1 ? workspaces[0].id : '')
    patch({ workspaces, workspaceId: target, itemId: '', items: [], detail: null, loading: target ? 'items' : null })
    if (target) await loadItems(target, target === workspaceId ? itemId : '', signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function loadItems(workspaceId: string, previousItemId: string, signal: AbortSignal): Promise<void> {
  const { items, notice } = await plugin.request('workflows.list', { workspaceId }, { signal })
  if (signal.aborted) return
  const itemId = items.some((entry) => entry.id === previousItemId) ? previousItemId : items[0]?.id ?? ''
  patch({ items, itemId, notice: notice ?? null, loading: itemId ? 'detail' : null })
  if (itemId) await inspect(workspaceId, itemId, signal)
}

async function selectWorkspace(workspaceId: string): Promise<void> {
  const current = read(run)
  if (!current || read(state).workspaceId === workspaceId) return
  const signal = startLookup(current, 'items', { workspaceId, itemId: '', detail: null, items: [], notice: null })
  try {
    await loadItems(workspaceId, '', signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function inspect(workspaceId: string, itemId: string, signal: AbortSignal): Promise<void> {
  const detail = await plugin.request('workflows.inspect', { workspaceId, itemId }, { signal })
  if (!signal.aborted) patch({ detail, loading: null })
}

async function selectItem(itemId: string): Promise<void> {
  const current = read(run)
  const { workspaceId, itemId: currentId } = read(state)
  if (!current || !workspaceId || currentId === itemId) return
  const signal = startLookup(current, 'detail', { itemId, detail: null })
  try {
    await inspect(workspaceId, itemId, signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function act(action: Action, artifactId?: string): Promise<void> {
  const current = read(run)
  const { workspaceId, itemId, agent, detail, acting, loading } = read(state)
  if (!current || !detail || acting || loading) return
  current.action = new AbortController()
  const { signal } = current.action
  patch({ acting: true, error: null })
  const selected = { workspaceId, itemId }
  try {
    switch (action) {
      case 'open': {
        if (!artifactId) break
        const { opened } = await plugin.request('workflows.open', { ...selected, artifactId }, { signal })
        if (!signal.aborted && !opened) patch({ error: strings().openFailed })
        break
      }
      case 'validate': {
        patch({ validation: null })
        const validation = await plugin.request('workflows.validate', selected, { signal })
        if (!signal.aborted) patch({ validation })
        break
      }
      case 'launch':
        patch({ launched: false })
        await plugin.request('workflows.launch', { ...selected, agent }, { signal })
        if (!signal.aborted) patch({ launched: true })
        break
    }
  } catch (error) {
    showError(error, signal)
  } finally {
    if (!signal.aborted) patch({ acting: false })
  }
}

export function setup(ctx: PanelContext): () => void {
  const current: Run = {}
  set(run, current)
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const previous = current.focused
      current.focused = context ? JSON.stringify([context.displayName, context.branch]) : null
      if (previous !== undefined && previous !== current.focused) void refresh(true)
    })
  )
  void refresh()
  return () => {
    current.lookup?.abort()
    current.action?.abort()
  }
}

function workspaceLabel(workspace: Workspace): string {
  const { project, name, branch } = workspace
  const parts = project && project !== name ? [project, name] : [name]
  if (branch && branch !== name) parts.push(branch)
  return parts.join(' · ')
}

function taskProgress(item: WorkflowItem): string | undefined {
  return item.completed === null || item.total === null ? undefined : `${item.completed}/${item.total}`
}

function noticeText(notice: Notice, t: Copy): string {
  switch (notice.kind) {
    case 'cli-missing': return t.cliMissing
    case 'cli-error': return t.cliError
    case 'unsupported': return t.unsupported
  }
}

function NoticeView({ notice, t }: { notice: Notice; t: Copy }) {
  return (
    <Callout tone="warning" title={noticeText(notice, t)} icon="warning">
      {notice.detail ? <Text>{notice.detail.slice(0, 3000)}</Text> : null}
    </Callout>
  )
}

function Artifact({ artifact, t, disabled }: { artifact: WorkflowArtifact; t: Copy; disabled: boolean }) {
  const kind = artifact.id.split(':', 1)[0]
  const suffix = artifact.title.indexOf(' · ')
  const name = Object.hasOwn(t.artifactNames, kind)
    ? t.artifactNames[kind as keyof Copy['artifactNames']] + (suffix < 0 ? '' : artifact.title.slice(suffix))
    : artifact.title
  const tone = artifact.state === 'done' ? 'success' : artifact.state === 'blocked' ? 'warning' : 'neutral'
  return (
    <ListItem
      title={name}
      description={artifact.path}
      icon="file-text"
      disabled={disabled}
      onPress={artifact.path ? () => act('open', artifact.id) : undefined}
    >
      <Badge tone={tone}>{t.states[artifact.state]}</Badge>
    </ListItem>
  )
}

function Detail({ t, detail, busy }: { t: Copy; detail: WorkflowDetail; busy: boolean }) {
  const { item } = detail
  const completed = item.completed
  const total = item.total
  return (
    <Stack gap="sm">
      <Heading level={2}>{item.title}</Heading>
      {completed !== null && total !== null && total > 0 ? (
        <Stack gap="xs">
          <Row justify="between">
            <Text size="xs" muted>{t.progress}</Text>
            <Text size="xs" muted>{taskProgress(item)}</Text>
          </Row>
          <Progress label={t.progress} labelHidden value={Math.min(100, (completed / total) * 100)} />
        </Stack>
      ) : null}
      <Heading level={3}>{t.artifacts}</Heading>
      {detail.artifacts.length ? (
        <List label={t.artifacts}>
          {detail.artifacts.map((artifact) => <Artifact key={artifact.id} artifact={artifact} t={t} disabled={busy} />)}
        </List>
      ) : (
        <Text muted size="sm">{t.emptyArtifacts}</Text>
      )}
      {detail.canValidate ? (
        <Button variant="outline" size="sm" icon="check" disabled={busy} onPress={() => act('validate')}>
          {t.check}
        </Button>
      ) : null}
      {detail.canLaunch ? (
        <Row gap="xs" wrap align="end">
          <Select label={t.agent} labelHidden value={read(state).agent} options={agents}
            disabled={busy} onChange={(agent) => patch({ agent: agent === 'claude' ? 'claude' : 'codex' })} />
          <Button tone="accent" size="sm" icon="play" disabled={busy} onPress={() => act('launch')}>
            {t.run}
          </Button>
        </Row>
      ) : null}
    </Stack>
  )
}

const agents = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' }
] as const

export default function Panel() {
  const t = strings()
  const value = read(state)
  const { workspaces, workspaceId, items, itemId, detail, loading, acting, notice, validation, launched } = value
  const visibleNotice = detail?.notice ?? notice
  const loadingText = loading === 'workspaces' ? t.workspacesLoading : loading === 'items' ? t.listLoading : t.detailLoading
  const emptyReady = !loading && !value.error && !visibleNotice
  return (
    <Stack gap="md">
      <Row align="center" justify="between">
        <Heading>OpenSpec</Heading>
        <IconButton icon="refresh" label={t.refresh} variant="ghost" disabled={acting} onPress={() => refresh()} />
      </Row>
      {workspaces.length > 0 ? (
        <Select
          label={t.workspace}
          value={workspaceId}
          placeholder={t.chooseWorkspace}
          disabled={loading === 'workspaces'}
          options={workspaces.map((workspace) => ({ value: workspace.id, label: workspaceLabel(workspace) }))}
          onChange={selectWorkspace}
        />
      ) : null}
      {loading ? <Spinner label={loadingText} /> : null}
      {value.error ? (
        <Callout tone="danger" title={t.operationFailed} icon="error">
          <Text>{value.error.slice(0, 3000)}</Text>
        </Callout>
      ) : null}
      {visibleNotice ? <NoticeView notice={visibleNotice} t={t} /> : null}
      {emptyReady && workspaces.length === 0 ? <EmptyState title={t.emptyWorkspaces} icon="folder" /> : null}
      {emptyReady && workspaces.length > 0 && !workspaceId ? (
        <EmptyState title={t.chooseWorkspace} icon="folder" />
      ) : null}
      {emptyReady && workspaceId && items.length === 0 ? <EmptyState title={t.emptyChanges} icon="book" /> : null}
      {items.length > 0 ? (
        <List label={t.changes}>
          {items.map((item) => (
            <ListItem
              key={item.id}
              title={item.title}
              description={item.title === item.id ? undefined : item.id}
              icon="book"
              current={item.id === itemId}
              onPress={() => selectItem(item.id)}
            >
              {taskProgress(item) ? <Badge>{taskProgress(item)}</Badge> : null}
            </ListItem>
          ))}
        </List>
      ) : null}
      {detail && loading !== 'workspaces' ? <Detail t={t} detail={detail} busy={acting || loading !== null} /> : null}
      {acting ? <Spinner label={t.actionLoading} /> : null}
      {validation ? (
        <Callout tone={validation.valid ? 'success' : 'danger'} title={validation.valid ? t.valid : t.invalid}>
          {validation.messages.slice(0, 50).map((message, index) => <Text key={index}>{message.slice(0, 3000)}</Text>)}
        </Callout>
      ) : null}
      {launched ? <Callout tone="success" title={t.launched} /> : null}
    </Stack>
  )
}
