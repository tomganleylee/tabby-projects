import { Injectable } from '@angular/core'
import { AppService, SelectorService } from 'tabby-core'
import { Project } from '../api'
import { ProjectTabComponent } from '../components/projectTab.component'
import { ProjectsService } from './projects.service'

/** Opens / finds / switches project tabs. The one place that knows both the service and the tab class. */
@Injectable({ providedIn: 'root' })
export class ProjectOpenerService {
    constructor (
        private app: AppService,
        private projects: ProjectsService,
        private selector: SelectorService,
    ) { }

    projectTabs (): ProjectTabComponent[] {
        return this.app.tabs.filter((t): t is ProjectTabComponent => t instanceof ProjectTabComponent)
    }

    findOpen (projectId: string): ProjectTabComponent | null {
        return this.projectTabs().find(t => t.project?.id === projectId) ?? null
    }

    activeProjectTab (): ProjectTabComponent | null {
        const t = this.app.activeTab
        return t instanceof ProjectTabComponent ? t : null
    }

    open (project: Project): ProjectTabComponent {
        const existing = this.findOpen(project.id)
        if (existing) {
            this.app.selectTab(existing)
            return existing
        }
        return this.app.openNewTabRaw({ type: ProjectTabComponent, inputs: { project } })
    }

    async quickOpen (): Promise<void> {
        const items = this.projects.cfg.items
        if (!items.length) return
        const result = await this.selector.show<Project>('Open project', items.map(p => ({
            name: p.name,
            description: [this.projects.group(p.group)?.name, p.cwd].filter(Boolean).join(' · '),
            icon: this.projects.iconFor(p),
            color: this.projects.colorFor(p) ?? undefined,
            group: this.projects.group(p.group)?.name,
            result: p,
        })))
        if (result) this.open(result)
    }
}
