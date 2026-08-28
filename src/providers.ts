import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, HotkeyDescription, HotkeyProvider, MenuItemOptions, NewTabParameters, NotificationsService, PlatformService, RecoveryToken, TabContextMenuItemProvider, TabRecoveryProvider, ToolbarButton, ToolbarButtonProvider } from 'tabby-core'
import { SettingsTabComponent, SettingsTabProvider } from 'tabby-settings'
import { SFTPContextMenuItemProvider, SFTPFile, SFTPPanelComponent } from 'tabby-ssh'
import { FILES_TAB_TOKEN_TYPE, PROJECT_TAB_TOKEN_TYPE } from './api'
import { FilesTabComponent } from './components/filesTab.component'
import { ProjectTabComponent, ProjectsSettingsOpener } from './components/projectTab.component'
import { ProjectsSettingsComponent } from './components/settings.component'
import { UI } from './icons'
import { LocalEditService } from './services/localEdit.service'
import { ProjectOpenerService } from './services/opener.service'
import { ProjectsService } from './services/projects.service'
import * as path from 'path'

@Injectable()
export class ProjectTabRecoveryProvider extends TabRecoveryProvider<ProjectTabComponent> {
    async applicableTo (token: RecoveryToken): Promise<boolean> {
        return token.type === PROJECT_TAB_TOKEN_TYPE
    }

    async recover (token: RecoveryToken): Promise<NewTabParameters<ProjectTabComponent>> {
        return {
            type: ProjectTabComponent,
            inputs: {
                projectId: token.projectId,
                recoveredChildren: token.children ?? [],
                recoveredActive: token.activeIndex ?? 0,
            },
        }
    }
}

@Injectable()
export class FilesTabRecoveryProvider extends TabRecoveryProvider<FilesTabComponent> {
    async applicableTo (token: RecoveryToken): Promise<boolean> {
        return token.type === FILES_TAB_TOKEN_TYPE
    }

    async recover (token: RecoveryToken): Promise<NewTabParameters<FilesTabComponent>> {
        return { type: FilesTabComponent, inputs: { path: token.path ?? '/' } }
    }
}

@Injectable()
export class ProjectsSettingsTabProvider extends SettingsTabProvider {
    id = 'projects'
    icon = 'folder-open'
    title = 'Projects'

    getComponentType (): any {
        return ProjectsSettingsComponent
    }
}

@Injectable()
export class ProjectsHotkeyProvider extends HotkeyProvider {
    async provide (): Promise<HotkeyDescription[]> {
        return [
            { id: 'projects-toggle-rail', name: 'Projects: toggle rail' },
            { id: 'projects-quick-open', name: 'Projects: quick open' },
            { id: 'projects-next-tab', name: 'Projects: next tab in project' },
            { id: 'projects-prev-tab', name: 'Projects: previous tab in project' },
            { id: 'projects-new-tab', name: 'Projects: new tab in project' },
        ]
    }
}

@Injectable()
export class ProjectsToolbarButtonProvider extends ToolbarButtonProvider {
    constructor (private opener: ProjectOpenerService) {
        super()
    }

    provide (): ToolbarButton[] {
        return [{
            icon: UI.sidebar,
            title: 'Projects',
            weight: 5,
            click: () => this.opener.quickOpen(),
        }]
    }
}

/** Right-click items in any SFTP panel (project Files tabs and Tabby's own SSH SFTP panel alike). */
@Injectable()
export class ProjectsSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 10

    constructor (
        private localEdit: LocalEditService,
        private platform: PlatformService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        if (item.isDirectory) return []
        const items: MenuItemOptions[] = [
            { label: 'Open in local editor', click: () => this.localEdit.editRemote(panel.session, item) },
        ]
        const prog = this.localEdit.programFor(item.name)
        if (prog) {
            items.push({ label: `Open with ${path.basename(prog)}`, click: () => this.localEdit.editRemote(panel.session, item, prog) })
        }
        items.push({ label: 'Copy remote path', click: () => this.platform.setClipboard({ text: item.fullPath }) })
        return items
    }
}

/** Right-click any terminal tab -> "Add to Projects" (uses its profile and current directory). */
@Injectable()
export class AddToProjectsContextMenu extends TabContextMenuItemProvider {
    weight = 20

    constructor (
        private projects: ProjectsService,
        private notifications: NotificationsService,
        private settingsOpener: ProjectsSettingsOpener,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        const profile = (tab as any).profile
        if (!profile?.type || tab instanceof ProjectTabComponent || tab instanceof FilesTabComponent) return []
        return [{
            label: 'Add to Projects',
            click: async () => {
                let cwd: string | null = null
                try { cwd = await (tab as any).session?.getWorkingDirectory?.() ?? null } catch { /* not supported */ }
                const p = this.projects.newProjectFromProfile(profile, cwd)
                this.notifications.info(`Added "${p.name}" to Projects`)
                this.settingsOpener.open(p.id)
            },
        }]
    }
}

@Injectable()
export class ProjectsSettingsOpenerImpl extends ProjectsSettingsOpener {
    constructor (private app: AppService) {
        super()
    }

    open (projectId: string | null): void {
        ;(window as any).__tabbyProjectsSelect = projectId
        const existing = this.app.tabs.find(t => t instanceof SettingsTabComponent) as any
        if (existing) {
            existing.activeTab = 'projects'
            this.app.selectTab(existing)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent, inputs: { activeTab: 'projects' } })
        }
    }
}
