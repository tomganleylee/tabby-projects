import { AfterViewInit, Component, EmbeddedViewRef, Injector, Input, ViewChild, ViewContainerRef } from '@angular/core'
import { Subject } from 'rxjs'
import { AppService, BaseTabComponent, BaseTabProcess, GetRecoveryTokenOptions, HostWindowService, MenuItemOptions, PlatformService, RecoveryToken, TabRecoveryService, TabsService } from 'tabby-core'
import { Project, ProjectTabSpec, PROJECT_TAB_TOKEN_TYPE } from '../api'
import { UI } from '../icons'
import { LaunchContext, ProjectsService, newSessionId } from '../services/projects.service'
import { FilesTabComponent } from './filesTab.component'

/** Recovery token for a child opened from a project tab spec — recovered by re-deriving, not replaying. */
const SPEC_TOKEN_TYPE = 'app:tabby-projects-spec'

/**
 * A top-level Tabby tab representing one project. Hosts any number of child tabs
 * (terminals, the Files browser) and shows exactly one at a time behind its own tab strip.
 */
@Component({
    selector: 'project-tab',
    template: `
        <div class="pt-strip">
            <div class="pt-tabs">
                <div class="pt-tab" *ngFor="let t of children"
                    [class.active]="t === active"
                    [class.activity]="t.hasActivity"
                    (click)="select(t)"
                    (auxclick)="onAux($event, t)"
                    (contextmenu)="childMenu($event, t)"
                    [title]="t.customTitle || t.title">
                    <span class="pt-ind" *ngIf="t === active"></span>
                    <proj-icon [icon]="t.icon" [color]="t === active ? projectColor : null"></proj-icon>
                    <span class="pt-name">{{ t.customTitle || t.title }}</span>
                    <span class="pt-attn" *ngIf="needsAttention(t)" title="Finished / waiting for you"></span>
                    <button class="pt-close" (click)="closeChild(t); $event.stopPropagation()" [innerHTML]="ui.x" title="Close"></button>
                    <span class="pt-cb" *ngIf="t === active" [style.background]="projectColor"></span>
                </div>
                <button class="pt-btn" (click)="addTabMenu($event)" [innerHTML]="ui.plus" title="New tab in this project"></button>
            </div>
            <div class="pt-space"></div>
            <button class="pt-btn" (click)="openFiles()" [innerHTML]="ui.folder" title="Files"></button>
            <button class="pt-btn" (click)="projectMenu($event)" [innerHTML]="ui.dots" title="Project"></button>
        </div>
        <div class="pt-body">
            <ng-container #vc></ng-container>
            <div class="pt-empty" *ngIf="!children.length">
                <div class="pt-empty-title">{{ project?.name }}</div>
                <div class="pt-empty-hint">No tabs open — press + to open one.</div>
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; }
        .pt-strip { flex: none; height: calc(38px * var(--spaciness, 1)); display: flex; align-items: stretch; background: var(--theme-bg-more-2); }
        .pt-tabs { display: flex; align-items: stretch; min-width: 0; overflow: hidden; }
        .pt-tab { position: relative; display: flex; align-items: center; gap: 8px; width: 170px; min-width: 0; padding: 0 10px; cursor: pointer; color: var(--theme-fg-more-2); font-size: 14px; }
        .pt-tab:hover { color: var(--theme-fg); }
        .pt-tab.active { color: var(--theme-fg); background: var(--body-bg); }
        .pt-tab.activity:not(.active) .pt-name { font-style: italic; }
        .pt-ind { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--bs-light, #e8e8e8); }
        .pt-cb { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
        .pt-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .pt-attn { width: 8px; height: 8px; border-radius: 50%; background: #f5a623; box-shadow: 0 0 6px #f5a623; flex: none; animation: pt-pulse 1.6s ease-in-out infinite; }
        @keyframes pt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
        .pt-close { flex: none; width: 22px; height: 22px; border: none; border-radius: 4px; background: transparent; color: inherit; opacity: 0; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
        .pt-close ::ng-deep svg { width: 12px; height: 12px; }
        .pt-tab:hover .pt-close, .pt-tab.active .pt-close { opacity: .7; }
        .pt-close:hover { opacity: 1 !important; background: rgba(0,0,0,.25); }
        .pt-btn { flex: none; width: calc(38px * var(--spaciness, 1)); border: none; background: transparent; color: var(--theme-fg-more); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; -webkit-app-region: no-drag; }
        .pt-btn ::ng-deep svg { width: 16px; height: 16px; }
        .pt-btn:hover { background: rgba(0,0,0,.125); color: var(--theme-fg); }
        .pt-space { flex: 1; -webkit-app-region: drag; }
        .pt-body { position: relative; flex: 1; min-height: 0; background: var(--body-bg); }
        .pt-body ::ng-deep > .pt-child { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
        .pt-body ::ng-deep > .pt-child.pt-hidden { left: -1000%; }
        .pt-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--theme-fg-more-2); }
        .pt-empty-title { font-size: 18px; color: var(--theme-fg-more); }
    `],
})
export class ProjectTabComponent extends BaseTabComponent implements AfterViewInit {
    @Input() project: Project | null = null
    @Input() projectId: string | null = null
    /** Set by the recovery provider; child tabs are rebuilt from these. */
    @Input() recoveredChildren: RecoveryToken[] | null = null
    @Input() recoveredActive = 0

    @ViewChild('vc', { read: ViewContainerRef }) viewContainer: ViewContainerRef

    children: BaseTabComponent[] = []
    active: BaseTabComponent | null = null
    childrenChanged$ = new Subject<void>()
    ui = UI

    private viewRefs = new Map<BaseTabComponent, EmbeddedViewRef<any>>()
    /** Which project tab spec a child was opened from (ad-hoc tabs are absent). */
    private specOf = new Map<BaseTabComponent, string>()
    /** The `{{session}}` UUID each child was launched with, so recovery can resume it. */
    private sessionOf = new Map<BaseTabComponent, string>()
    /** Children that rang the bell while not being looked at. */
    private attention = new Set<BaseTabComponent>()
    private hostWindow: HostWindowService
    private app: AppService
    private projects: ProjectsService
    private tabs: TabsService
    private tabRecovery: TabRecoveryService
    private platform: PlatformService

    constructor (private injector: Injector) {
        super(injector)
        this.app = injector.get(AppService)
        this.projects = injector.get(ProjectsService)
        this.tabs = injector.get(TabsService)
        this.tabRecovery = injector.get(TabRecoveryService)
        this.platform = injector.get(PlatformService)
        this.hostWindow = injector.get(HostWindowService)

        this.subscribeUntilDestroyed(this.visibility$, v => this.active?.emitVisibility(v))
        this.subscribeUntilDestroyed(this.focused$, () => {
            this.active?.emitFocused()
            if (this.active) this.clearAttention(this.active)
        })
        this.subscribeUntilDestroyed(this.hostWindow.windowFocused$, () => {
            if (this.app.activeTab === this && this.active) this.clearAttention(this.active)
        })
        this.subscribeUntilDestroyed(this.blurred$, () => this.active?.emitBlurred())
    }

    get projectColor (): string | null {
        return this.project ? this.projects.colorFor(this.project) : null
    }

    async ngAfterViewInit (): Promise<void> {
        if (!this.project && this.projectId) this.project = this.projects.find(this.projectId)
        if (!this.project) {
            setTimeout(() => this.app.closeTab(this, false))
            return
        }
        this.applyProjectLook()

        if (this.recoveredChildren) {
            for (const token of this.recoveredChildren) {
                try {
                    if (token.type === SPEC_TOKEN_TYPE) {
                        // Re-derive from the *current* project config rather than replaying the
                        // profile snapshot Tabby stored — so config edits and fixes apply on restart.
                        const spec = this.project.tabs.find(t => t.id === token.specId)
                        if (spec) await this.openSpec(spec, false, { sessionId: token.sessionId ?? newSessionId(), recovering: true })
                        continue
                    }
                    const params = await this.tabRecovery.recoverTab(token)
                    if (!params) continue
                    const tab = this.tabs.create(params)
                    if (tab instanceof FilesTabComponent) tab.projectTab = this
                    this.addChild(tab, false)
                } catch (e) {
                    console.warn('tabby-projects: could not recover child tab', e)
                }
            }
            this.recoveredChildren = null
        } else {
            for (const spec of this.project.tabs.filter(t => t.autoOpen)) {
                await this.openSpec(spec, false)
            }
        }
        this.select(this.children[Math.min(this.recoveredActive, this.children.length - 1)] ?? null)
    }

    applyProjectLook (): void {
        if (!this.project) return
        this.setTitle(this.project.name)
        this.icon = this.projects.iconFor(this.project)
        this.color = this.projectColor
    }

    // ---- children --------------------------------------------------------------

    async openSpec (spec: ProjectTabSpec, activate = true, ctx?: LaunchContext): Promise<BaseTabComponent | null> {
        if (!this.project) return null
        if (spec.kind === 'files') return this.openFiles(activate)
        ctx = ctx ?? { sessionId: newSessionId(), recovering: false }
        const tab = await this.projects.createShellTab(this.project, spec, ctx)
        if (!tab) return null
        if (spec.id !== 'adhoc') {
            this.specOf.set(tab, spec.id)
            this.sessionOf.set(tab, ctx.sessionId)
        }
        if (spec.icon) tab.icon = spec.icon
        this.addChild(tab, activate)
        return tab
    }

    async openFiles (activate = true): Promise<BaseTabComponent | null> {
        if (!this.project) return null
        const existing = this.children.find(c => c instanceof FilesTabComponent)
        if (existing) {
            if (activate) this.select(existing)
            return existing
        }
        const base = await this.projects.baseProfile(this.project)
        if (!this.projects.isRemote(base)) {
            // Local project: just open the folder in the OS file manager.
            if (this.project.cwd) this.platform.openPath(this.project.cwd)
            return null
        }
        const tab = this.tabs.create({
            type: FilesTabComponent,
            inputs: { projectTab: this, path: this.project.cwd || '/' },
        })
        this.addChild(tab, activate)
        return tab
    }

    addChild (tab: BaseTabComponent, activate = true): void {
        tab.parent = this
        this.children.push(tab)
        const ref = tab.insertIntoContainer(this.viewContainer)
        this.viewRefs.set(tab, ref)
        const el = ref.rootNodes[0] as HTMLElement
        el.classList.add('pt-child', 'pt-hidden')

        tab.subscribeUntilDestroyed(tab.destroyed$, () => this.removeChild(tab))
        tab.subscribeUntilDestroyed(tab.titleChange$, () => this.childrenChanged$.next())
        tab.subscribeUntilDestroyed(tab.activity$, () => this.childrenChanged$.next())
        tab.subscribeUntilDestroyed(tab.progress$, p => this.setProgress(p))
        tab.subscribeUntilDestroyed(tab.activity$, a => { if (a && !this.isLookingAt(tab)) this.displayActivity() })
        this.watchBell(tab)

        if (activate || !this.active) this.select(tab)
        this.childrenChanged$.next()
    }

    removeChild (tab: BaseTabComponent): void {
        const idx = this.children.indexOf(tab)
        if (idx === -1) return
        this.children.splice(idx, 1)
        this.specOf.delete(tab)
        this.sessionOf.delete(tab)
        this.attention.delete(tab)
        tab.removeFromContainer()
        this.viewRefs.delete(tab)
        if (this.active === tab) {
            this.select(this.children[Math.min(idx, this.children.length - 1)] ?? null)
        }
        this.childrenChanged$.next()
    }

    select (tab: BaseTabComponent | null): void {
        if (this.active && this.active !== tab) {
            this.active.emitBlurred()
            this.active.emitVisibility(false)
            this.active.clearActivity()
        }
        this.active = tab
        for (const [child, ref] of this.viewRefs) {
            (ref.rootNodes[0] as HTMLElement).classList.toggle('pt-hidden', child !== tab)
        }
        if (tab) {
            setTimeout(() => {
                tab.emitVisibility(true)
                tab.emitFocused()
                tab.clearActivity()
            })
            if (document.hasFocus()) this.clearAttention(tab)
        }
        this.childrenChanged$.next()
    }

    // ---- bell / attention -------------------------------------------------------

    /** True when the user can currently see this child: window focused, project tab active, child active. */
    isLookingAt (tab: BaseTabComponent): boolean {
        return document.hasFocus() && this.app.activeTab === this && this.active === tab
    }

    needsAttention (tab: BaseTabComponent): boolean {
        return this.attention.has(tab)
    }

    get hasAttention (): boolean {
        return this.attention.size > 0
    }

    clearAttention (tab: BaseTabComponent): void {
        if (this.attention.delete(tab)) {
            if (!this.attention.size) this.clearActivity()
            this.childrenChanged$.next()
        }
    }

    private watchBell (tab: BaseTabComponent): void {
        const started = Date.now()
        const attach = (): void => {
            const frontend = (tab as any).frontend
            if (frontend?.bell$) {
                tab.subscribeUntilDestroyed(frontend.bell$, () => this.onBell(tab))
            } else if (Date.now() - started < 30_000 && !(tab as any)._destroyCalled) {
                setTimeout(attach, 500)
            }
        }
        attach()
    }

    private onBell (tab: BaseTabComponent): void {
        if (this.isLookingAt(tab)) return
        this.attention.add(tab)
        this.displayActivity()
        this.childrenChanged$.next()
        if (this.projects.cfg.notifyOnBell) this.notify(tab)
    }

    private notify (tab: BaseTabComponent): void {
        try {
            const n = new Notification(`${this.project?.name ?? 'Project'} · ${tab.customTitle || tab.title}`, {
                body: 'Finished — waiting for you',
                silent: true,
            })
            n.onclick = () => {
                this.hostWindow.bringToFront()
                this.app.selectTab(this)
                this.select(tab)
            }
        } catch (e) {
            console.warn('tabby-projects: notification failed', e)
        }
    }

    selectRelative (delta: number): void {
        if (!this.children.length) return
        const i = this.active ? this.children.indexOf(this.active) : 0
        this.select(this.children[(i + delta + this.children.length) % this.children.length])
    }

    async closeChild (tab: BaseTabComponent): Promise<void> {
        if (!await tab.canClose()) return
        tab.destroy()
    }

    getSSHSession (): any | null {
        for (const c of this.children as any[]) {
            if (c.sshSession && typeof c.sshSession.openSFTP === 'function') return c.sshSession
        }
        return null
    }

    // ---- menus -----------------------------------------------------------------

    addTabMenu (event?: MouseEvent): void {
        if (!this.project) return
        const items: MenuItemOptions[] = this.project.tabs.map(spec => ({
            label: spec.title,
            click: () => this.openSpec(spec),
        }))
        items.push({ type: 'separator' })
        items.push({ label: 'Plain shell', click: () => this.openSpec({ id: 'adhoc', title: 'Shell', kind: 'shell' }) })
        items.push({ label: 'Files', click: () => this.openFiles() })
        this.platform.popupContextMenu(items, event)
    }

    childMenu (event: MouseEvent, tab: BaseTabComponent): void {
        event.preventDefault()
        this.platform.popupContextMenu([
            { label: 'Close', click: () => this.closeChild(tab) },
            { label: 'Close others', click: () => this.children.filter(c => c !== tab).forEach(c => this.closeChild(c)) },
            { type: 'separator' },
            { label: 'Move to its own Tabby tab', click: () => this.detach(tab) },
        ], event)
    }

    projectMenu (event?: MouseEvent): void {
        this.platform.popupContextMenu([
            { label: 'Rename tab…', click: () => this.app.renameTab?.(this) },
            { label: 'Project settings', click: () => this.openSettings() },
            { type: 'separator' },
            { label: 'Close project', click: () => this.app.closeTab(this, true) },
        ], event)
    }

    onAux (event: MouseEvent, tab: BaseTabComponent): void {
        if (event.button === 1) {
            event.preventDefault()
            this.closeChild(tab)
        }
    }

    detach (tab: BaseTabComponent): void {
        this.removeChild(tab)
        tab.parent = null
        this.app.wrapAndAddTab(tab)
    }

    openSettings (): void {
        this.injector.get(ProjectsSettingsOpener, null)?.open(this.project?.id ?? null)
    }

    // ---- BaseTabComponent ------------------------------------------------------

    async getRecoveryToken (options?: GetRecoveryTokenOptions): Promise<RecoveryToken | null> {
        if (!this.project) return null
        const children: RecoveryToken[] = []
        for (const c of this.children) {
            const specId = this.specOf.get(c)
            if (specId) {
                children.push({ type: SPEC_TOKEN_TYPE, specId, sessionId: this.sessionOf.get(c) ?? null })
                continue
            }
            const t = await this.tabRecovery.getFullRecoveryToken(c, options)
            if (t) children.push(t)
        }
        return {
            type: PROJECT_TAB_TOKEN_TYPE,
            projectId: this.project.id,
            activeIndex: this.active ? Math.max(0, this.children.indexOf(this.active)) : 0,
            children,
            tabIcon: this.icon,
            tabColor: this.projectColor,
        }
    }

    async getCurrentProcess (): Promise<BaseTabProcess | null> {
        return this.active?.getCurrentProcess() ?? null
    }

    async canClose (): Promise<boolean> {
        for (const c of this.children) {
            if (!await c.canClose()) return false
        }
        return true
    }

    destroy (skipDestroyedEvent = false): void {
        for (const c of [...this.children]) c.destroy()
        super.destroy(skipDestroyedEvent)
    }
}

/** Implemented by the settings side so the tab can open its own project's settings without importing it. */
export abstract class ProjectsSettingsOpener {
    abstract open (projectId: string | null): void
}
