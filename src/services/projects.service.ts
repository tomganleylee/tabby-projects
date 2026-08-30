import { Injectable } from '@angular/core'
import { BaseTabComponent, ConfigService, LogService, Logger, NotificationsService, PartialProfile, Profile, ProfilesService, TabsService } from 'tabby-core'
import { Project, ProjectGroup, ProjectTabSpec, ProjectsConfig, uid } from '../api'
import { builtinIcon } from '../icons'

/** Default Claude Code commands: a fixed session id at launch, resumed by id after a restart. */
export const CLAUDE_COMMAND = 'claude --session-id {{session}}'
export const CLAUDE_RESUME = 'claude --resume {{session}}'

export interface LaunchContext {
    /** Per-tab-instance UUID substituted for `{{session}}`. */
    sessionId: string
    /** True when re-creating the tab after a Tabby restart. */
    recovering: boolean
}

export function newSessionId (): string {
    const c: any = globalThis.crypto
    if (c?.randomUUID) return c.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = Math.random() * 16 | 0
        return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
}

/** Pick the launch or recovery command for a spec and expand placeholders. */
export function resolveCommand (spec: ProjectTabSpec, ctx: LaunchContext): string | null {
    let cmd = spec.command ?? null
    if (ctx.recovering) {
        if (spec.recoverCommand) cmd = spec.recoverCommand
        else if (cmd?.includes('--session-id {{session}}')) cmd = cmd.replace('--session-id {{session}}', '--resume {{session}}')
    }
    return cmd
        ? cmd.replace(/\{\{\s*session\s*\}\}/g, ctx.sessionId).replace(/\{\{\s*sid\s*\}\}/g, ctx.sessionId.slice(0, 8))
        : null
}

/** Config access + turning a project's tab spec into a real Tabby tab. Knows nothing about the UI. */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
    private logger: Logger

    constructor (
        private config: ConfigService,
        private profiles: ProfilesService,
        private tabs: TabsService,
        private notifications: NotificationsService,
        log: LogService,
    ) {
        this.logger = log.create('projects')
    }

    get cfg (): ProjectsConfig {
        return this.config.store.projects
    }

    save (): void {
        this.config.save()
    }

    find (id: string): Project | null {
        return this.cfg.items.find(p => p.id === id) ?? null
    }

    group (id: string | null | undefined): ProjectGroup | null {
        return this.cfg.groups.find(g => g.id === id) ?? null
    }

    /** Effective colour: the project's own, else its group's. */
    colorFor (project: Project): string | null {
        return project.color || this.group(project.group)?.color || null
    }

    iconFor (project: Project): string {
        return project.icon || builtinIcon('folder')
    }

    defaultTabs (): ProjectTabSpec[] {
        return [
            { id: uid(), title: 'Claude', kind: 'shell', command: CLAUDE_COMMAND, recoverCommand: CLAUDE_RESUME, icon: builtinIcon('robot'), autoOpen: true },
            { id: uid(), title: 'Shell', kind: 'shell', icon: builtinIcon('terminal'), autoOpen: true },
            { id: uid(), title: 'Files', kind: 'files', icon: builtinIcon('folder'), autoOpen: false },
        ]
    }

    newProject (partial: Partial<Project> = {}): Project {
        const p: Project = {
            id: uid(),
            name: 'New project',
            group: this.cfg.groups[0]?.id ?? null,
            icon: builtinIcon('folder'),
            color: null,
            profile: null,
            cwd: null,
            promptExpect: null,
            pinned: true,
            tabs: this.defaultTabs(),
            ...partial,
        }
        this.cfg.items.push(p)
        this.save()
        return p
    }

    /** Create a project from an existing Tabby profile (name, icon and colour carried over). */
    newProjectFromProfile (profile: PartialProfile<Profile>, cwd: string | null = null): Project {
        const tabs = this.defaultTabs()
        if (profile.type !== 'ssh') tabs.splice(2, 1) // no Files tab for local shells
        return this.newProject({
            name: profile.name,
            profile: profile.id ?? null,
            icon: profile.icon || builtinIcon('folder'),
            color: profile.color || null,
            cwd,
            tabs,
        })
    }

    isPinned (p: Project): boolean {
        return p.pinned !== false
    }

    setPinned (p: Project, pinned: boolean): void {
        p.pinned = pinned
        this.save()
    }

    newGroup (name = 'New group'): ProjectGroup {
        const g: ProjectGroup = { id: uid(), name, color: null, collapsed: false }
        this.cfg.groups.push(g)
        this.save()
        return g
    }

    removeProject (project: Project): void {
        this.cfg.items = this.cfg.items.filter(p => p.id !== project.id)
        this.save()
    }

    async allProfiles (): Promise<PartialProfile<Profile>[]> {
        const list = await this.profiles.getProfiles({ includeBuiltin: true })
        return list.filter(p => !p.isTemplate)
    }

    async baseProfile (project: Project): Promise<PartialProfile<Profile> | null> {
        if (!project.profile) return null
        return (await this.allProfiles()).find(p => p.id === project.profile) ?? null
    }

    isRemote (base: PartialProfile<Profile> | null): boolean {
        return !!base && base.type !== 'local'
    }

    /**
     * Build a throwaway profile for one tab of a project: the project's base profile plus
     * `cd <cwd> && <command>`, delivered the way the shell type expects.
     */
    async childProfile (project: Project, spec: ProjectTabSpec, ctx: LaunchContext): Promise<PartialProfile<any> | null> {
        const base = await this.baseProfile(project)
        if (!base) {
            this.notifications.error(`Project "${project.name}" has no host profile set`)
            return null
        }
        const command = resolveCommand(spec, ctx)
        const dynamicTitle = spec.dynamicTitle ?? /claude/i.test(command ?? '')
        const p: any = {
            ...base,
            options: { ...(base.options ?? {}) },
            name: `${project.name} · ${spec.title}`,
            icon: spec.icon ?? project.icon ?? base.icon,
            color: this.colorFor(project) ?? base.color,
            disableDynamicTitle: !dynamicTitle,
        }

        this.logger.info(`launch "${project.name} · ${spec.title}" recovering=${ctx.recovering} session=${ctx.sessionId} command=${JSON.stringify(command)}`)
        const parts: string[] = []
        if (project.cwd) parts.push(`cd ${quote(project.cwd, base.type === 'local')}`)
        if (command) parts.push(command)
        if (!parts.length) return p

        if (base.type === 'local') {
            const shell = String(base.options?.command ?? '').toLowerCase()
            if (project.cwd) p.options.cwd = project.cwd
            if (command) {
                if (shell.includes('powershell') || shell.includes('pwsh')) {
                    p.options.args = ['-NoLogo', '-NoExit', '-Command', command]
                } else if (shell.endsWith('cmd.exe') || shell === 'cmd') {
                    p.options.args = ['/k', command]
                } else if (shell.includes('bash') || shell.includes('zsh') || shell.includes('sh')) {
                    p.options.args = ['-c', `${command}; exec ${shellBasename(shell)} -l`]
                } else {
                    // Unknown shell (WSL, fish, nu…): fall back to typing it once the prompt appears.
                    p.options.scripts = [this.loginScript(project, command)]
                }
            }
        } else {
            // SSH / telnet / serial: type the command once the prompt shows up.
            p.options.scripts = [this.loginScript(project, parts.join(' && '))]
        }
        return p
    }

    private loginScript (project: Project, command: string): { expect: string, isRegex: boolean, send: string, optional: boolean } {
        // NOT optional: Tabby discards an optional script on the first output chunk that doesn't
        // match (i.e. the MOTD), so it would never see the prompt. Tabby appends the newline itself.
        return {
            expect: project.promptExpect || this.cfg.promptExpect,
            isRegex: true,
            send: command,
            optional: false,
        }
    }

    /** Create (but do not add) a Tabby tab for a `shell` spec. */
    async createShellTab (project: Project, spec: ProjectTabSpec, ctx: LaunchContext): Promise<BaseTabComponent | null> {
        const profile = await this.childProfile(project, spec, ctx)
        if (!profile) return null
        const params = await this.profiles.newTabParametersForProfile(profile)
        if (!params) return null
        const tab = this.tabs.create(params)
        tab.setTitle(spec.title)
        return tab
    }
}

function quote (s: string, windows: boolean): string {
    if (!/[\s"'$&|;()]/.test(s)) return s
    return windows ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`
}

function shellBasename (shell: string): string {
    const m = shell.match(/([a-z]+)(\.exe)?$/)
    return m ? m[1] : 'bash'
}
