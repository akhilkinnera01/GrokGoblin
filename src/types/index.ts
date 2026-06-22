export type GrokModel =
  | "grok-build-0.1"
  | "grok-code-fast-1"
  | "grok-3"
  | "grok-3-mini"
  | string;

export type GrokMode = "code" | "plan" | "ask";

export type GgMode =
  | "ralph"
  | "cruise"
  | "goblinplan"
  | "dig"
  | "quest"
  | "research"
  | "swarm";

export type ModelClass = "default" | "fast" | "standard";

export type SetupScope = "user" | "project";

export interface GgConfig {
  version: string;
  scope: SetupScope;
  grokHome: string;
  ggStateDir: string;
  installedSkills: string[];
  installMode: "standard";
  subagentsEnabled: boolean;
  mcpEnabled: boolean;
}

export interface ModeState {
  active: boolean;
  mode: GgMode;
  iteration: number;
  maxIterations: number;
  currentPhase: string;
  taskDescription: string;
  startedAt: string;
  completedAt?: string;
  lastTurnAt: string;
  runOutcome?: "success" | "failure" | "blocked" | "cancelled";
  ownerSessionId: string;
}

export interface SkillActiveState {
  [skillName: string]: {
    mode?: GgMode;
    active: boolean;
    lastActivatedAt: string;
    sessionId: string;
  };
}

export interface SessionState {
  sessionId: string;
  startedAt: string;
  cwd: string;
  pid: number;
  platform: string;
  tmuxSessionName?: string;
  tmuxPaneId?: string;
  grokModel?: string;
}

export type HookEventName =
  | "session-start"
  | "session-end"
  | "session-idle"
  | "turn-complete"
  | "pre-tool-use"
  | "post-tool-use"
  | "run.finished"
  | "run.failed"
  | "run.blocked"
  | "worker.assigned"
  | "worker.stalled"
  | "mode-started"
  | "mode-ended";

export interface HookEventEnvelope {
  schemaVersion: "1";
  event: string;
  timestamp: string;
  sessionId: string;
  workspaceRoot: string;
  mode?: GgMode;
  source: "gg";
  context: Record<string, unknown>;
}

export interface HookDispatchResult {
  pluginPath: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  reasoningEffort: "low" | "medium" | "high";
  model: GrokModel;
  modelClass: ModelClass;
  posture: "orchestrator" | "deep-worker" | "fast-lane";
  routingRole: "leader" | "specialist" | "executor";
  tools: "read-only" | "analysis" | "execution";
  category: "build" | "review" | "domain" | "coordination";
}

export interface ResolvedLaunchPolicy {
  policy: "direct" | "inside-tmux" | "detached-tmux";
  reason: string;
}

export interface WorktreeOptions {
  name?: string;
  detached?: boolean;
}

export interface LaunchOptions {
  worktree?: string | boolean;
  berserk?: boolean;
  yolo?: boolean;
  high?: boolean;
  xhigh?: boolean;
  direct?: boolean;
  tmux?: boolean;
  model?: string;
  fast?: boolean;
  mode?: GrokMode;
  notify?: string;
  parallel?: number;
}

export interface SetupOptions {
  scope?: SetupScope;
  force?: boolean;
  mergeAgents?: boolean;
  subagents?: boolean;
  mcp?: boolean;
  skip?: string[];
}

export interface DoctorCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
}
