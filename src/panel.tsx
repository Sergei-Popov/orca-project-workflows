import {
  atom,
  Badge,
  Button,
  Callout,
  Collapsible,
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
  Textarea,
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
  WorkflowProvider,
  Workspace
} from './protocol'

const en = {
  title: 'Project Workflows',
  workspace: 'Workspace',
  provider: 'Method',
  chooseWorkspace: 'Select a workspace',
  emptyWorkspaces: 'No available workspaces',
  refresh: 'Refresh',
  workspacesLoading: 'Loading workspaces',
  listLoading: 'Loading changes',
  storyLoading: 'Loading BMAD stories',
  detailLoading: 'Loading artifacts',
  changes: 'Changes',
  emptyChanges: 'No OpenSpec changes',
  stories: 'Stories',
  emptyStories: 'No BMAD stories',
  previous: 'Previous',
  next: 'Next',
  artifacts: 'Artifacts',
  emptyArtifacts: 'No artifacts found',
  progress: 'Tasks completed',
  noTasks: 'No tasks',
  check: 'Validate',
  run: 'Start with agent',
  continueStory: 'Continue story',
  agent: 'Agent',
  buildAgent: 'Build agent',
  actionLoading: 'Working',
  valid: 'OpenSpec validation passed',
  invalid: 'OpenSpec validation found problems',
  launched: 'Agent started in this workspace',
  operationFailed: 'Could not complete the request',
  openFailed: 'Could not open the artifact',
  cliMissing: 'OpenSpec CLI is unavailable',
  cliError: 'OpenSpec CLI returned an error',
  unsupported: 'This workspace is unsupported',
  bmadMissing: 'BMAD Method is not installed in this workspace',
  bmadUnsupported: 'This BMAD version is unsupported',
  bmadConfig: 'Could not read BMAD project files',
  quickBuild: 'Build a small change',
  intent: 'Describe the change',
  startBuild: 'Start BMAD Build',
  storyStates: {
    'backlog': 'Backlog', 'ready-for-dev': 'Ready for development', 'ready': 'Ready',
    'in-progress': 'In progress', 'review': 'In review', 'in-review': 'In review', 'draft': 'Draft', 'done': 'Done', 'pending': 'Pending',
    'todo': 'To do', 'completed': 'Completed', 'blocked': 'Blocked'
  },
  states: { done: 'File exists', ready: 'Ready to create', blocked: 'Blocked', missing: 'Missing' },
  artifactNames: { proposal: 'Proposal', specs: 'Specifications', design: 'Design', tasks: 'Tasks' }
}
const ru: typeof en = {
  title: 'Рабочие процессы',
  workspace: 'Рабочая область',
  provider: 'Метод',
  chooseWorkspace: 'Выберите рабочую область',
  emptyWorkspaces: 'Нет доступных рабочих областей',
  refresh: 'Обновить',
  workspacesLoading: 'Загрузка рабочих областей',
  listLoading: 'Загрузка изменений',
  storyLoading: 'Загрузка историй BMAD',
  detailLoading: 'Загрузка артефактов',
  changes: 'Изменения',
  emptyChanges: 'Нет изменений OpenSpec',
  stories: 'Истории',
  emptyStories: 'Нет историй BMAD',
  previous: 'Назад',
  next: 'Далее',
  artifacts: 'Артефакты',
  emptyArtifacts: 'Артефакты не найдены',
  progress: 'Задач выполнено',
  noTasks: 'Нет задач',
  check: 'Проверить',
  run: 'Запустить агента',
  continueStory: 'Продолжить историю',
  agent: 'Агент',
  buildAgent: 'Агент для доработки',
  actionLoading: 'Выполняется',
  valid: 'Проверка OpenSpec пройдена',
  invalid: 'Проверка OpenSpec нашла ошибки',
  launched: 'Агент запущен в рабочей области',
  operationFailed: 'Не удалось выполнить запрос',
  openFailed: 'Не удалось открыть артефакт',
  cliMissing: 'OpenSpec CLI недоступен',
  cliError: 'Ошибка OpenSpec CLI',
  unsupported: 'Рабочая область не поддерживается',
  bmadMissing: 'BMAD Method не установлен в этой рабочей области',
  bmadUnsupported: 'Эта версия BMAD не поддерживается',
  bmadConfig: 'Не удалось прочитать файлы проекта BMAD',
  quickBuild: 'Небольшая доработка',
  intent: 'Опишите изменение',
  startBuild: 'Запустить BMAD Build',
  storyStates: {
    'backlog': 'В очереди', 'ready-for-dev': 'Готово к разработке', 'ready': 'Готово к работе',
    'in-progress': 'В работе', 'review': 'На ревью', 'in-review': 'На ревью', 'draft': 'Черновик', 'done': 'Готово', 'pending': 'Ожидает',
    'todo': 'К выполнению', 'completed': 'Выполнено', 'blocked': 'Заблокировано'
  },
  states: { done: 'Файл создан', ready: 'Можно создать', blocked: 'Заблокировано', missing: 'Отсутствует' },
  artifactNames: { proposal: 'Предложение', specs: 'Спецификации', design: 'Проектирование', tasks: 'Задачи' }
}
type Copy = typeof en

type Loading = 'workspaces' | 'items' | 'detail'
type Action = 'open' | 'validate' | 'launch' | 'build'

interface PanelState {
  workspaces: Workspace[]
  workspaceId: string
  provider: WorkflowProvider
  items: WorkflowItem[]
  itemId: string
  detail: WorkflowDetail | null
  agent: AgentKind
  buildAgent: AgentKind
  buildAgents: AgentKind[]
  intent: string
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
  provider: 'openspec',
  items: [],
  itemId: '',
  detail: null,
  agent: 'codex',
  buildAgent: 'codex',
  buildAgents: [],
  intent: '',
  loading: 'workspaces',
  acting: false,
  notice: null,
  error: null,
  validation: null,
  launched: false
})
const itemsPerPage = 40
const page = atom(0)

interface Run {
  lookup?: AbortController
  action?: AbortController
  focused?: string | null
}
const run = atom<Run | null>(null)
const methodPreference = atom<WorkflowProvider>('method', 'openspec', { persist: 'plugin' })

function patch(fields: Partial<PanelState>): void {
  update(state, (previous) => ({ ...previous, ...fields }))
}

function strings(): Copy {
  return env.locale.toLowerCase().split('-')[0] === 'ru' ? ru : en
}

function providerParam(provider: WorkflowProvider) {
  return provider === 'bmad' ? { provider } : {}
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
  const { workspaceId, itemId, provider } = read(state)
  const signal = startLookup(current, 'workspaces', { notice: null, detail: null, buildAgents: [] })
  try {
    const { workspaces, suggestedId } = await plugin.request('workflows.workspaces', undefined, { signal })
    if (signal.aborted) return
    const preserved = workspaces.some((entry) => entry.id === workspaceId) ? workspaceId : ''
    const suggested = workspaces.find((entry) => entry.id === suggestedId)?.id ?? ''
    const target = preferFocus ? suggested : preserved || suggested
    patch({ workspaces, workspaceId: target, itemId: '', items: [], detail: null, buildAgents: [], loading: target ? 'items' : null,
      ...(target !== workspaceId ? { intent: '' } : {}) })
    if (target) await loadItems(target, provider, target === workspaceId ? itemId : '', signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function loadItems(workspaceId: string, provider: WorkflowProvider, previousItemId: string, signal: AbortSignal): Promise<void> {
  const { items, notice, buildAgents } = await plugin.request('workflows.list', { workspaceId, ...providerParam(provider) }, { signal })
  if (signal.aborted) return
  const itemId = items.some((entry) => entry.id === previousItemId) ? previousItemId : items[0]?.id ?? ''
  set(page, Math.floor(Math.max(0, items.findIndex((entry) => entry.id === itemId)) / itemsPerPage))
  patch({ items, itemId, notice: notice ?? null, buildAgents: buildAgents ?? [], loading: itemId ? 'detail' : null })
  if (itemId) await inspect(workspaceId, itemId, provider, signal)
}

async function selectWorkspace(workspaceId: string): Promise<void> {
  const current = read(run)
  const value = read(state)
  if (!current || value.acting || !workspaceId || value.workspaceId === workspaceId) return
  const signal = startLookup(current, 'items', { workspaceId, itemId: '', detail: null, items: [], notice: null, buildAgents: [], intent: '' })
  try {
    await loadItems(workspaceId, read(state).provider, '', signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function selectProvider(provider: WorkflowProvider): Promise<void> {
  const current = read(run)
  const { workspaceId, provider: previous, acting, loading } = read(state)
  if (!current || acting || loading === 'workspaces' || provider === previous) return
  set(methodPreference, provider)
  const signal = startLookup(current, 'items', { provider, itemId: '', items: [], detail: null, notice: null, buildAgents: [], intent: '' })
  if (!workspaceId) {
    patch({ loading: null })
    return
  }
  try {
    await loadItems(workspaceId, provider, '', signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function inspect(workspaceId: string, itemId: string, provider: WorkflowProvider, signal: AbortSignal): Promise<void> {
  const detail = await plugin.request('workflows.inspect', { workspaceId, itemId, ...providerParam(provider) }, { signal })
  if (!signal.aborted) patch({ detail, loading: null })
}

async function selectItem(itemId: string): Promise<void> {
  const current = read(run)
  const { workspaceId, itemId: currentId, provider, acting, loading } = read(state)
  if (!current || acting || loading === 'workspaces' || !workspaceId || currentId === itemId) return
  const signal = startLookup(current, 'detail', { itemId, detail: null })
  try {
    await inspect(workspaceId, itemId, provider, signal)
  } catch (error) {
    showError(error, signal)
  }
}

async function act(action: Action, artifactId?: string): Promise<void> {
  const current = read(run)
  const { workspaceId, itemId, provider, agent, detail, buildAgent, buildAgents, intent, acting, loading } = read(state)
  if (!current || !workspaceId || acting || loading || (action !== 'build' && !detail)) return
  current.action = new AbortController()
  const { signal } = current.action
  patch({ acting: true, error: null })
  const selected = { workspaceId, itemId, ...providerParam(provider) }
  try {
    switch (action) {
      case 'open': {
        if (!artifactId) break
        const { opened } = await plugin.request('workflows.open', { ...selected, artifactId }, { signal })
        if (!signal.aborted && !opened) patch({ error: strings().openFailed })
        break
      }
      case 'validate': {
        if (provider !== 'openspec' || !detail?.canValidate) break
        patch({ validation: null })
        const validation = await plugin.request('workflows.validate', { workspaceId, itemId }, { signal })
        if (!signal.aborted) patch({ validation })
        break
      }
      case 'launch': {
        if (!detail?.canLaunch) break
        const target = chooseAgent(agent, detail?.agents)
        if (!target) break
        patch({ launched: false })
        await plugin.request('workflows.launch', { ...selected, agent: target }, { signal })
        if (!signal.aborted) patch({ launched: true })
        break
      }
      case 'build': {
        const target = chooseAgent(buildAgent, buildAgents)
        if (provider !== 'bmad') break
        if (!target || !intent.trim()) break
        patch({ launched: false })
        await plugin.request('workflows.bmadBuild', { workspaceId, agent: target, intent: intent.trim() }, { signal })
        if (!signal.aborted) patch({ launched: true, intent: '' })
        break
      }
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
  patch({ provider: read(methodPreference) === 'bmad' ? 'bmad' : 'openspec' })
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const previous = current.focused
      current.focused = context ? JSON.stringify([context.displayName, context.branch]) : null
      if (previous === undefined || previous === current.focused) return
      const { workspaceId, workspaces } = read(state)
      const selected = workspaces.find((entry) => entry.id === workspaceId)
      if (context && selected?.name === context.displayName && (selected.branch ?? '') === context.branch) return
      void refresh(true)
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
    case 'bmad-missing': return t.bmadMissing
    case 'bmad-unsupported': return t.bmadUnsupported
    case 'bmad-config': return t.bmadConfig
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

function Detail({ t, detail, provider, agent, busy }: {
  t: Copy
  detail: WorkflowDetail
  provider: WorkflowProvider
  agent: AgentKind
  busy: boolean
}) {
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
      {detail.canLaunch && chooseAgent(agent, detail.agents) ? (
        <Row gap="xs" wrap align="end">
          <AgentSelect label={t.agent} agent={agent} available={detail.agents} disabled={busy}
            onChange={(agent) => patch({ agent })} />
          <Button tone="accent" size="sm" icon="play" disabled={busy} onPress={() => act('launch')}>
            {provider === 'bmad' ? t.continueStory : t.run}
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
const supportedAgents = agents.map(({ value }) => value)

function chooseAgent(agent: AgentKind, available: readonly AgentKind[] = supportedAgents): AgentKind | undefined {
  return available.includes(agent) ? agent : available[0]
}

function AgentSelect({ label, agent, available, disabled, onChange }: {
  label: string
  agent: AgentKind
  available?: readonly AgentKind[]
  disabled: boolean
  onChange: (agent: AgentKind) => void
}) {
  const options = available ? agents.filter(({ value }) => available.includes(value)) : agents
  return (
    <Select label={label} labelHidden value={chooseAgent(agent, available)} options={options}
      disabled={disabled} onChange={(value) => {
        if (value === 'claude' || value === 'codex') onChange(value)
      }} />
  )
}

function QuickBuild({ t, value, busy }: { t: Copy; value: PanelState; busy: boolean }) {
  const { buildAgent, buildAgents, intent, items } = value
  return (
    <Collapsible title={t.quickBuild} defaultOpen={items.length === 0}>
      <Stack gap="sm">
        <Textarea label={t.intent} value={intent} rows={3} maxLength={2000} disabled={busy}
          onChange={(intent) => patch({ intent, launched: false })} />
        <Row gap="xs" wrap align="end">
          <AgentSelect label={t.buildAgent} agent={buildAgent} available={buildAgents} disabled={busy}
            onChange={(buildAgent) => patch({ buildAgent })} />
          <Button tone="accent" size="sm" icon="play" disabled={busy || !intent.trim()} onPress={() => act('build')}>
            {t.startBuild}
          </Button>
        </Row>
      </Stack>
    </Collapsible>
  )
}

const methods = [
  { value: 'openspec', label: 'OpenSpec' },
  { value: 'bmad', label: 'BMAD Method' }
] as const

function itemProgress(item: WorkflowItem, provider: WorkflowProvider, t: Copy): string | undefined {
  if (provider !== 'bmad') return item.total === 0 ? t.noTasks : taskProgress(item)
  const status = item.status
  if (status && Object.hasOwn(t.storyStates, status)) return t.storyStates[status as keyof Copy['storyStates']]
  return status
}

export default function Panel() {
  const t = strings()
  const value = read(state)
  const { workspaces, workspaceId, provider, items, itemId, detail, loading, acting, notice, validation, launched } = value
  const bmad = provider === 'bmad'
  const busy = acting || loading !== null
  const visibleNotice = detail?.notice ?? notice
  const pageIndex = read(page)
  const pageCount = Math.ceil(items.length / itemsPerPage)
  const loadingText = loading === 'workspaces'
    ? t.workspacesLoading
    : loading === 'items' ? (bmad ? t.storyLoading : t.listLoading) : t.detailLoading
  const emptyReady = !loading && !value.error && !visibleNotice
  return (
    <Stack gap="md">
      <Row align="center" justify="between">
        <Heading>{t.title}</Heading>
        <IconButton icon="refresh" label={t.refresh} variant="ghost" disabled={acting} onPress={() => refresh()} />
      </Row>
      {workspaces.length > 0 ? (
        <Select
          label={t.workspace}
          value={workspaceId}
          placeholder={t.chooseWorkspace}
          disabled={acting || loading === 'workspaces'}
          options={workspaces.map((workspace) => ({ value: workspace.id, label: workspaceLabel(workspace) }))}
          onChange={selectWorkspace}
        />
      ) : null}
      {workspaceId ? (
        <Select label={t.provider} value={provider} options={methods} disabled={acting || loading === 'workspaces'}
          onChange={(next) => selectProvider(next === 'bmad' ? 'bmad' : 'openspec')} />
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
      {emptyReady && workspaceId && items.length === 0 ? (
        <EmptyState title={bmad ? t.emptyStories : t.emptyChanges} icon="book" />
      ) : null}
      {items.length > 0 ? (
        <Stack gap="xs">
          <List label={bmad ? t.stories : t.changes}>
            {items.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage).map((item) => {
              const progress = itemProgress(item, provider, t)
              const description = bmad ? item.subtitle : item.title === item.id ? undefined : item.id
              return (
                <ListItem key={item.id} title={item.title.slice(0, 512)}
                  description={description?.slice(0, 512)} icon="book" current={item.id === itemId}
                  disabled={acting || loading === 'workspaces'} onPress={() => selectItem(item.id)}>
                  {progress ? <Badge>{progress}</Badge> : null}
                </ListItem>
              )
            })}
          </List>
          {pageCount > 1 ? (
            <Row align="center" justify="between">
              <Button variant="ghost" size="sm" disabled={busy || pageIndex === 0}
                onPress={() => set(page, pageIndex - 1)}>{t.previous}</Button>
              <Text size="xs" muted>{`${pageIndex + 1} / ${pageCount}`}</Text>
              <Button variant="ghost" size="sm" disabled={busy || pageIndex + 1 === pageCount}
                onPress={() => set(page, pageIndex + 1)}>{t.next}</Button>
            </Row>
          ) : null}
        </Stack>
      ) : null}
      {detail ? <Detail t={t} detail={detail} provider={provider} agent={value.agent} busy={busy} /> : null}
      {bmad && value.buildAgents.length ? <QuickBuild t={t} value={value} busy={busy} /> : null}
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
