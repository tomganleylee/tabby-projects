import { ChangeDetectorRef, Component, HostBinding, NgZone, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, BaseTabComponent, ConfigService, HostAppService, Platform, PlatformService, ProfilesService, SelectorService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'
import { Project, ProjectGroup, ProjectsConfig } from '../api'
import { UI } from '../icons'
import { ProjectOpenerService } from '../services/opener.service'
import { ProjectsService } from '../services/projects.service'
import { ProjectTabComponent } from './projectTab.component'

interface RailGroup {
    group: ProjectGroup | null
    projects: Project[]
    more: Project[]
}

/** The left-hand project rail. Injected next to Tabby's main content by RailService. */
@Component({
    selector: 'projects-rail',
    template: `
        <div class="pr-head">
            <button class="pr-iconbtn" (click)="toggleCollapse()" [innerHTML]="ui.sidebar" [title]="collapsed ? 'Expand' : 'Collapse'"></button>
            <span class="pr-title" *ngIf="!collapsed">Projects</span>
            <button class="pr-iconbtn" *ngIf="!collapsed" (click)="addProject()" [innerHTML]="ui.plus" title="Add project from a profile"></button>
        </div>
        <div class="pr-search" *ngIf="!collapsed" (click)="opener.quickOpen()">
            <span [innerHTML]="ui.search"></span><span class="pr-search-text">Jump to project…</span>
        </div>

        <div class="pr-scroll">
            <div class="pr-group" *ngFor="let g of groups">
                <div class="pr-group-h" (click)="toggleGroup(g.group)" [class.compact]="collapsed" *ngIf="g.group || groups.length > 1">
                    <span class="pr-sw" [style.background]="g.group?.color || 'var(--theme-fg-more-2)'"></span>
                    <ng-container *ngIf="!collapsed">
                        <span class="pr-group-name">{{ g.group?.name || 'Ungrouped' }}</span>
                        <span class="pr-chev" [innerHTML]="isCollapsed(g.group) ? ui.chevRight : ui.chevDown"></span>
                    </ng-container>
                </div>
                <ng-container *ngIf="!isCollapsed(g.group)">
                    <ng-container *ngFor="let p of g.projects">
                        <ng-container *ngTemplateOutlet="projectRow; context: { $implicit: p, sub: false }"></ng-container>
                    </ng-container>
                    <ng-container *ngIf="g.more.length">
                        <div class="pr-more" [class.compact]="collapsed" (click)="toggleMore(g)" title="More projects">
                            <span class="pr-ico" [innerHTML]="isMoreOpen(g) ? ui.chevDown : ui.chevRight"></span>
                            <span class="pr-name" *ngIf="!collapsed">More <span class="pr-count">{{ g.more.length }}</span></span>
                        </div>
                        <ng-container *ngIf="isMoreOpen(g)">
                            <ng-container *ngFor="let p of g.more">
                                <ng-container *ngTemplateOutlet="projectRow; context: { $implicit: p, sub: true }"></ng-container>
                            </ng-container>
                        </ng-container>
                    </ng-container>
                </ng-container>
            </div>

            <div class="pr-group" *ngIf="otherTabs.length">
                <div class="pr-group-h" [class.compact]="collapsed">
                    <span class="pr-sw" style="background: var(--theme-fg-more-2)"></span>
                    <span class="pr-group-name" *ngIf="!collapsed">Other tabs</span>
                </div>
                <div class="pr-item" *ngFor="let t of otherTabs"
                    [class.active]="app.activeTab === t"
                    [class.compact]="collapsed"
                    (click)="app.selectTab(t)"
                    (auxclick)="$event.button === 1 && app.closeTab(t, true)"
                    [title]="t.customTitle || t.title">
                    <span class="pr-bar" *ngIf="app.activeTab === t" [style.background]="t.color || 'var(--theme-fg-more)'"></span>
                    <span class="pr-ico"><proj-icon [icon]="t.icon || ui.terminal" [color]="t.color"></proj-icon></span>
                    <ng-container *ngIf="!collapsed">
                        <span class="pr-name">{{ t.customTitle || t.title }}</span>
                        <button class="pr-close" (click)="app.closeTab(t, true); $event.stopPropagation()" [innerHTML]="ui.x"></button>
                    </ng-container>
                </div>
            </div>
        </div>

        <ng-template #projectRow let-p let-sub="sub">
            <div class="pr-item" [class.sub]="sub"
                [class.active]="isActive(p)"
                [class.open]="!!tabFor(p)"
                [class.compact]="collapsed"
                [class.activity]="tabFor(p)?.hasActivity"
                (click)="open(p)"
                (auxclick)="onAux($event, p)"
                (contextmenu)="projectMenu($event, p)"
                [title]="p.name">
                <span class="pr-bar" *ngIf="isActive(p)" [style.background]="colorFor(p)"></span>
                <span class="pr-ico" [style.color]="isActive(p) || tabFor(p) ? colorFor(p) : null">
                    <proj-icon [icon]="projects.iconFor(p)"></proj-icon>
                    <span class="pr-dot" *ngIf="collapsed && tabFor(p)"></span>
                </span>
                <ng-container *ngIf="!collapsed">
                    <span class="pr-name">{{ p.name }}</span>
                    <span class="pr-count" *ngIf="tabFor(p) as t">{{ t.children.length }}</span>
                    <span class="pr-dot" *ngIf="tabFor(p)"></span>
                </ng-container>
            </div>
        </ng-template>

        <div class="pr-foot">
            <button class="pr-footbtn" (click)="newTab()" [title]="'New terminal tab'">
                <span [innerHTML]="ui.plus"></span><span *ngIf="!collapsed">New tab</span>
            </button>
            <button class="pr-footbtn" (click)="openSettings()" [title]="'Manage projects'">
                <span [innerHTML]="ui.cog"></span><span *ngIf="!collapsed">Manage</span>
            </button>
        </div>
        <div class="pr-grip" *ngIf="!collapsed" (mousedown)="startResize($event)"></div>
    `,
    styles: [`
        :host { position: relative; display: flex; flex-direction: column; flex: none; height: 100%; background: var(--theme-bg-more-2); color: var(--theme-fg-more); font-size: 14px; user-select: none; border-right: 1px solid rgba(0,0,0,.25); }
        .pr-head { flex: none; height: calc(38px * var(--spaciness, 1)); display: flex; align-items: center; gap: 4px; padding: 0 6px 0 8px; -webkit-app-region: drag; }
        .pr-title { flex: 1; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--theme-fg-more-2); padding-left: 4px; }
        .pr-iconbtn, .pr-close { border: none; background: transparent; color: var(--theme-fg-more-2); width: 26px; height: 26px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; -webkit-app-region: no-drag; }
        .pr-iconbtn:hover, .pr-close:hover { background: rgba(0,0,0,.25); color: var(--theme-fg); }
        .pr-iconbtn ::ng-deep svg, .pr-close ::ng-deep svg { width: 14px; height: 14px; }
        .pr-search { margin: 0 8px 6px; height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: 5px; background: var(--theme-bg-more); color: var(--theme-fg-more-2); font-size: 13px; cursor: pointer; }
        .pr-search ::ng-deep svg { width: 13px; height: 13px; }
        .pr-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
        .pr-group-h { height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--theme-fg-more-2); cursor: pointer; }
        .pr-group-h.compact { justify-content: center; padding: 0; }
        .pr-sw { width: 8px; height: 8px; border-radius: 2px; flex: none; }
        .pr-group-h.compact .pr-sw { width: 18px; height: 3px; }
        .pr-group-name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .pr-chev { display: inline-flex; opacity: .7; }
        .pr-chev ::ng-deep svg { width: 12px; height: 12px; }
        .pr-item { position: relative; height: calc(38px * var(--spaciness, 1)); display: flex; align-items: center; gap: 10px; padding: 0 10px 0 16px; cursor: pointer; color: var(--theme-fg-more); }
        .pr-item.compact { justify-content: center; padding: 0; gap: 0; }
        .pr-item.sub:not(.compact) { padding-left: 28px; height: calc(32px * var(--spaciness, 1)); font-size: 13px; }
        .pr-more { height: 28px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 16px; cursor: pointer; color: var(--theme-fg-more-2); font-size: 12px; }
        .pr-more.compact { justify-content: center; padding: 0; }
        .pr-more:hover { color: var(--theme-fg); background: rgba(0,0,0,.15); }
        .pr-more .pr-ico { font-size: 12px; } .pr-more .pr-ico ::ng-deep svg { width: 12px; height: 12px; }
        .pr-item:hover { background: rgba(0,0,0,.15); color: var(--theme-fg); }
        .pr-item.active { background: var(--body-bg); color: var(--theme-fg); }
        .pr-item.activity:not(.active) .pr-name { font-style: italic; }
        .pr-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
        .pr-ico { position: relative; display: inline-flex; font-size: 16px; color: var(--theme-fg-more-2); }
        .pr-item.compact .pr-ico { font-size: 18px; }
        .pr-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .pr-count { font-size: 11px; color: var(--theme-fg-more-2); background: var(--theme-bg-more); padding: 1px 6px; border-radius: 9px; }
        .pr-dot { width: 7px; height: 7px; border-radius: 50%; background: #b1e969; flex: none; }
        .pr-item.compact .pr-dot { position: absolute; right: -4px; top: -3px; }
        .pr-item .pr-close { opacity: 0; }
        .pr-item:hover .pr-close { opacity: 1; }
        .pr-foot { flex: none; display: flex; border-top: 1px solid rgba(0,0,0,.25); }
        .pr-footbtn { flex: 1; height: 32px; border: none; background: transparent; color: var(--theme-fg-more-2); font-size: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
        .pr-footbtn:hover { background: rgba(0,0,0,.25); color: var(--theme-fg); }
        .pr-footbtn ::ng-deep svg { width: 13px; height: 13px; }
        .pr-grip { position: absolute; top: 0; right: -3px; width: 6px; height: 100%; cursor: col-resize; }
    `],
})
export class RailComponent implements OnInit, OnDestroy {
    groups: RailGroup[] = []
    otherTabs: BaseTabComponent[] = []
    ui = UI
    private subs: Subscription[] = []
    private timer: any

    constructor (
        public app: AppService,
        public projects: ProjectsService,
        public opener: ProjectOpenerService,
        private config: ConfigService,
        private platform: PlatformService,
        private profiles: ProfilesService,
        private selector: SelectorService,
        private hostApp: HostAppService,
        private zone: NgZone,
        private cdr: ChangeDetectorRef,
    ) { }

    get cfg (): ProjectsConfig { return this.projects.cfg }
    get collapsed (): boolean { return this.cfg.collapsed }

    @HostBinding('style.width.px') get width (): number {
        return this.collapsed ? 52 : this.cfg.railWidth
    }

    @HostBinding('class.mac-inset') get macInset (): boolean {
        return this.hostApp.platform === Platform.macOS
    }

    ngOnInit (): void {
        this.rebuild()
        this.subs.push(this.config.changed$.subscribe(() => this.rebuild()))
        const anyApp = this.app as any
        if (anyApp.tabsChanged$) this.subs.push(anyApp.tabsChanged$.subscribe(() => this.rebuild()))
        this.subs.push(this.app.activeTabChange$.subscribe(() => this.cdr.detectChanges()))
        // Child-tab counts and activity flags change outside our subscriptions; a cheap tick keeps them honest.
        this.zone.runOutsideAngular(() => {
            this.timer = setInterval(() => this.zone.run(() => this.cdr.detectChanges()), 1000)
        })
    }

    ngOnDestroy (): void {
        this.subs.forEach(s => s.unsubscribe())
        clearInterval(this.timer)
    }

    rebuild (): void {
        const byGroup = new Map<string | null, Project[]>()
        for (const p of this.cfg.items) {
            const key = this.projects.group(p.group) ? p.group! : null
            if (!byGroup.has(key)) byGroup.set(key, [])
            byGroup.get(key)!.push(p)
        }
        this.groups = []
        const split = (list: Project[]): { projects: Project[], more: Project[] } => ({
            projects: list.filter(p => this.projects.isPinned(p) || this.tabFor(p)),
            more: list.filter(p => !this.projects.isPinned(p) && !this.tabFor(p)),
        })
        for (const g of this.cfg.groups) {
            if (byGroup.has(g.id)) this.groups.push({ group: g, ...split(byGroup.get(g.id)!) })
        }
        if (byGroup.has(null)) this.groups.push({ group: null, ...split(byGroup.get(null)!) })
        this.otherTabs = this.app.tabs.filter(t => !(t instanceof ProjectTabComponent))
        this.cdr.detectChanges()
    }

    tabFor (p: Project): ProjectTabComponent | null {
        return this.opener.findOpen(p.id)
    }

    isActive (p: Project): boolean {
        const t = this.tabFor(p)
        return !!t && this.app.activeTab === t
    }

    colorFor (p: Project): string | null {
        return this.projects.colorFor(p) ?? 'var(--theme-fg-more)'
    }

    open (p: Project): void {
        this.opener.open(p)
    }

    onAux (event: MouseEvent, p: Project): void {
        if (event.button !== 1) return
        event.preventDefault()
        const t = this.tabFor(p)
        if (t) this.app.closeTab(t, true)
    }

    projectMenu (event: MouseEvent, p: Project): void {
        event.preventDefault()
        const t = this.tabFor(p)
        this.platform.popupContextMenu([
            { label: t ? 'Switch to' : 'Open', click: () => this.open(p) },
            { label: 'Close', enabled: !!t, click: () => t && this.app.closeTab(t, true) },
            { type: 'separator' },
            { label: this.projects.isPinned(p) ? 'Unpin (move to "More")' : 'Pin', click: () => { this.projects.setPinned(p, !this.projects.isPinned(p)); this.rebuild() } },
            { label: 'Edit project…', click: () => this.openSettings(p.id) },
            { label: 'Remove from list', click: () => this.removeProject(p) },
        ], event)
    }

    async removeProject (p: Project): Promise<void> {
        const t = this.tabFor(p)
        if (t) this.app.closeTab(t, true)
        this.projects.removeProject(p)
        this.rebuild()
    }

    /** Collapse state is mirrored locally so the click reflects instantly, then persisted. */
    private collapsedLocal = new Map<string, boolean>()

    isCollapsed (g: ProjectGroup | null): boolean {
        if (!g) return false
        return this.collapsedLocal.get(g.id) ?? !!g.collapsed
    }

    toggleGroup (g: ProjectGroup | null): void {
        if (!g) return
        const next = !this.isCollapsed(g)
        this.collapsedLocal.set(g.id, next)
        this.cdr.detectChanges()
        const stored = this.cfg.groups.find(x => x.id === g.id)
        if (stored) {
            stored.collapsed = next
            this.projects.save()
        }
    }

    toggleCollapse (): void {
        this.cfg.collapsed = !this.cfg.collapsed
        this.projects.save()
    }

    private moreOpen = new Set<string>()

    isMoreOpen (g: RailGroup): boolean {
        return this.moreOpen.has(g.group?.id ?? '')
    }

    toggleMore (g: RailGroup): void {
        const key = g.group?.id ?? ''
        if (this.moreOpen.has(key)) this.moreOpen.delete(key); else this.moreOpen.add(key)
        this.cdr.detectChanges()
    }

    async addProject (): Promise<void> {
        const list = await this.projects.allProfiles()
        const picked = await this.selector.show<any>('New project from profile', [
            { name: 'Blank project', description: 'Set everything up by hand', icon: this.ui.plus, result: 'blank', weight: -1 },
            ...list.map(p => ({
                ...this.profiles.selectorOptionForProfile(p),
                result: p,
            })),
        ])
        if (!picked) return
        const project = picked === 'blank' ? this.projects.newProject() : this.projects.newProjectFromProfile(picked)
        this.rebuild()
        this.openSettings(project.id)
    }

    async newTab (): Promise<void> {
        const list = await this.projects.allProfiles()
        const picked = await this.selector.show<any>('Select profile', list.map(p => ({
            ...this.profiles.selectorOptionForProfile(p),
            result: p,
        })))
        if (picked) await this.profiles.launchProfile(picked)
    }

    openSettings (projectId: string | null = null): void {
        const existing = this.app.tabs.find(t => t instanceof SettingsTabComponent) as any
        const tab = existing ?? this.app.openNewTabRaw({ type: SettingsTabComponent, inputs: { activeTab: 'projects' } })
        if (existing) {
            this.app.selectTab(existing)
            existing.activeTab = 'projects'
        }
        ;(window as any).__tabbyProjectsSelect = projectId
        void tab
    }

    // ---- resize ------------------------------------------------------------------

    private resizing = false
    startResize (event: MouseEvent): void {
        event.preventDefault()
        this.resizing = true
        const startX = event.clientX
        const startW = this.cfg.railWidth
        const move = (e: MouseEvent): void => {
            if (!this.resizing) return
            this.cfg.railWidth = Math.max(160, Math.min(480, startW + e.clientX - startX))
            this.cdr.detectChanges()
        }
        const up = (): void => {
            this.resizing = false
            document.removeEventListener('mousemove', move)
            document.removeEventListener('mouseup', up)
            this.projects.save()
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
    }
}
