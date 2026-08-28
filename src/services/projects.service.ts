import { Injectable } from '@angular/core'
import { BaseTabComponent, ConfigService, NotificationsService, PartialProfile, Profile, ProfilesService, TabsService } from 'tabby-core'
import { Project, ProjectGroup, ProjectTabSpec, ProjectsConfig, uid } from '../api'
import { builtinIcon } from '../icons'

/** Config access + turning a project's tab spec into a real Tabby tab. Knows nothing about the UI. */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
    constructor (
        private config: ConfigService,
        private profiles: ProfilesService,
        private tabs: TabsService,
        private notifications: NotificationsService,
    ) { }

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
            { id: uid(), title: 'Claude', kind: 'shell', command: 'claude', icon: builtinIcon('robot'), autoOpen: true },
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
            tabs: this.defaultTabs(),
            ...partial,
        }
        this.cfg.items.push(p)
        this.save()
        return p
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
    async childProfile (project: Project, spec: ProjectTabSpec): Promise<PartialProfile<any> | null> {
        const base = await this.baseProfile(project)
        if (!base) {
            this.notifications.error(`Project "${project.name}" has no host profile set`)
            return null
        }
        const p: any = {
            ...base,
            options: { ...(base.options ?? {}) },
            name: `${project.name} · ${spec.title}`,
            icon: spec.icon ?? project.icon ?? base.icon,
            color: this.colorFor(project) ?? base.color,
            disableDynamicTitle: true,
        }

        const parts: string[] = []
        if (project.cwd) parts.push(`cd ${quote(project.cwd, base.type === 'local')}`)
        if (spec.command) parts.push(spec.command)
        if (!parts.length) return p

        if (base.type === 'local') {
            const shell = String(base.options?.command ?? '').toLowerCase()
            if (project.cwd) p.options.cwd = project.cwd
            if (spec.command) {
                if (shell.includes('powershell') || shell.includes('pwsh')) {
                    p.options.args = ['-NoLogo', '-NoExit', '-Command', spec.command]
                } else if (shell.endsWith('cmd.exe') || shell === 'cmd') {
                    p.options.args = ['/k', spec.command]
                } else if (shell.includes('bash') || shell.includes('zsh') || shell.includes('sh')) {
                    p.options.args = ['-c', `${spec.command}; exec ${shellBasename(shell)} -l`]
                } else {
                    // Unknown shell (WSL, fish, nu…): fall back to typing it once the prompt appears.
                    p.options.scripts = [this.loginScript(project, spec.command)]
                }
            }
        } else {
            // SSH / telnet / serial: type the command once the prompt shows up.
            p.options.scripts = [this.loginScript(project, parts.join(' && '))]
        }
        return p
    }

    private loginScript (project: Project, command: string): { expect: string, isRegex: boolean, send: string, optional: boolean } {
        return {
            expect: project.promptExpect || this.cfg.promptExpect,
            isRegex: true,
            send: command + '\\n',
            optional: true,
        }
    }

    /** Create (but do not add) a Tabby tab for a `shell` spec. */
    async createShellTab (project: Project, spec: ProjectTabSpec): Promise<BaseTabComponent | null> {
        const profile = await this.childProfile(project, spec)
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
