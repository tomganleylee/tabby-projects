import { Component, OnInit } from '@angular/core'
import { AppService, PartialProfile, Profile } from 'tabby-core'
import { Project, ProjectGroup, ProjectTabSpec, ProjectsConfig, uid } from '../api'
import { UI, builtinIcon } from '../icons'
import { ProjectOpenerService } from '../services/opener.service'
import { ProjectsService } from '../services/projects.service'

type Selection = { kind: 'general' } | { kind: 'group', group: ProjectGroup } | { kind: 'project', project: Project }

@Component({
    selector: 'projects-settings',
    template: `
        <div class="ps">
            <div class="ps-side">
                <div class="ps-side-item" [class.active]="sel.kind === 'general'" (click)="sel = { kind: 'general' }">
                    <span [innerHTML]="ui.cog"></span><span>General</span>
                </div>
                <div class="ps-side-h">Projects <button class="btn btn-sm btn-link" (click)="addProject()" title="Add project" [innerHTML]="ui.plus"></button></div>
                <ng-container *ngFor="let g of groupsWithProjects()">
                    <div class="ps-side-group" *ngIf="g.group" [class.active]="isSel('group', g.group)" (click)="sel = { kind: 'group', group: g.group }">
                        <span class="ps-sw" [style.background]="g.group.color || 'var(--theme-fg-more-2)'"></span>{{ g.group.name }}
                    </div>
                    <div class="ps-side-group" *ngIf="!g.group"><span class="ps-sw"></span>Ungrouped</div>
                    <div class="ps-side-item ps-indent" *ngFor="let p of g.projects" [class.active]="isSel('project', p)" (click)="sel = { kind: 'project', project: p }">
                        <proj-icon [icon]="projects.iconFor(p)" [color]="projects.colorFor(p)"></proj-icon><span>{{ p.name }}</span>
                    </div>
                </ng-container>
                <div class="ps-side-h">Groups <button class="btn btn-sm btn-link" (click)="addGroup()" title="Add group" [innerHTML]="ui.plus"></button></div>
            </div>

            <div class="ps-main">
                <!-- General -->
                <ng-container *ngIf="sel.kind === 'general'">
                    <h3>Projects</h3>
                    <div class="form-line"><label>Show project rail</label><input type="checkbox" class="form-check-input" [(ngModel)]="cfg.showRail" (ngModelChange)="save()"></div>
                    <div class="form-line"><label>Hide Tabby's own tab bar while the rail is shown</label><input type="checkbox" class="form-check-input" [(ngModel)]="cfg.hideTabBar" (ngModelChange)="save()"></div>
                    <div class="form-line"><label>Rail width</label><input type="number" class="form-control form-control-sm w-100px" min="160" max="480" [(ngModel)]="cfg.railWidth" (ngModelChange)="save()"></div>
                    <div class="form-line">
                        <label>Prompt pattern <small>(regex; a shell is "ready" when its output matches this — commands are typed after it)</small></label>
                        <input class="form-control form-control-sm" [(ngModel)]="cfg.promptExpect" (ngModelChange)="save()">
                    </div>

                    <h4>Open remote files with</h4>
                    <p class="text-muted small">Double-click in a project's Files tab downloads the file to a temp folder, opens it, and uploads it again every time you save. By default the OS default app is used; override per extension here.</p>
                    <table class="table table-sm">
                        <tr *ngFor="let row of openWithRows; let i = index">
                            <td class="w-100px"><input class="form-control form-control-sm" placeholder="md" [(ngModel)]="row.ext" (ngModelChange)="saveOpenWith()"></td>
                            <td><input class="form-control form-control-sm" placeholder="C:\\Path\\To\\Editor.exe" [(ngModel)]="row.program" (ngModelChange)="saveOpenWith()"></td>
                            <td class="w-40px"><button class="btn btn-sm btn-link" (click)="openWithRows.splice(i, 1); saveOpenWith()" [innerHTML]="ui.trash"></button></td>
                        </tr>
                    </table>
                    <button class="btn btn-sm btn-secondary" (click)="openWithRows.push({ ext: '', program: '' })">Add extension</button>

                    <h4>Keyboard</h4>
                    <p class="text-muted small">Shortcuts live in Tabby's Hotkeys settings under "Projects": toggle rail, quick open, next/previous tab in project, new tab in project.</p>
                </ng-container>

                <!-- Group -->
                <ng-container *ngIf="sel.kind === 'group'">
                    <h3>Group</h3>
                    <div class="form-line"><label>Name</label><input class="form-control form-control-sm" [(ngModel)]="sel.group.name" (ngModelChange)="save()"></div>
                    <div class="form-line"><label>Colour</label>
                        <div class="ps-colors">
                            <span class="ps-color" *ngFor="let c of palette" [style.background]="c" [class.active]="sel.group.color === c" (click)="sel.group.color = c; save()"></span>
                            <input type="color" [ngModel]="sel.group.color || '#888888'" (ngModelChange)="sel.group.color = $event; save()">
                            <button class="btn btn-sm btn-link" (click)="sel.group.color = null; save()">none</button>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-danger mt-3" (click)="removeGroup(sel.group)">Delete group</button>
                </ng-container>

                <!-- Project -->
                <ng-container *ngIf="sel.kind === 'project'">
                    <div class="ps-project-head">
                        <span class="ps-big-icon" [style.background]="projects.colorFor(sel.project) || 'var(--theme-bg-more-2)'"><proj-icon [icon]="projects.iconFor(sel.project)"></proj-icon></span>
                        <h3>{{ sel.project.name }}</h3>
                        <button class="btn btn-sm btn-primary ms-auto" (click)="opener.open(sel.project)">Open</button>
                    </div>
                    <div class="row">
                        <div class="col-8 form-line"><label>Name</label><input class="form-control form-control-sm" [(ngModel)]="sel.project.name" (ngModelChange)="save()"></div>
                        <div class="col-4 form-line"><label>Group</label>
                            <select class="form-control form-control-sm" [(ngModel)]="sel.project.group" (ngModelChange)="save()">
                                <option [ngValue]="null">Ungrouped</option>
                                <option *ngFor="let g of cfg.groups" [ngValue]="g.id">{{ g.name }}</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-line"><label>Icon</label><icon-picker [value]="sel.project.icon" [color]="projects.colorFor(sel.project)" (valueChange)="sel.project.icon = $event; save()"></icon-picker></div>
                    <div class="form-line"><label>Colour <small>(blank = group colour)</small></label>
                        <div class="ps-colors">
                            <span class="ps-color" *ngFor="let c of palette" [style.background]="c" [class.active]="sel.project.color === c" (click)="sel.project.color = c; save()"></span>
                            <input type="color" [ngModel]="sel.project.color || '#888888'" (ngModelChange)="sel.project.color = $event; save()">
                            <button class="btn btn-sm btn-link" (click)="sel.project.color = null; save()">none</button>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-6 form-line"><label>Host profile <small>(local shell or SSH)</small></label>
                            <select class="form-control form-control-sm" [(ngModel)]="sel.project.profile" (ngModelChange)="save()">
                                <option [ngValue]="null">— choose —</option>
                                <option *ngFor="let p of profiles" [ngValue]="p.id">{{ p.name }} <ng-container *ngIf="p.group">({{ p.group }})</ng-container></option>
                            </select>
                        </div>
                        <div class="col-6 form-line"><label>Working directory</label><input class="form-control form-control-sm mono" placeholder="/opt/my-project" [(ngModel)]="sel.project.cwd" (ngModelChange)="save()"></div>
                    </div>
                    <div class="row">
                        <div class="col-8 form-line"><label>Prompt pattern override <small>(blank = global)</small></label><input class="form-control form-control-sm mono" [(ngModel)]="sel.project.promptExpect" (ngModelChange)="save()"></div>
                        <div class="col-4 form-line"><label>Pinned <small>(unpinned fold into "More")</small></label><input type="checkbox" class="form-check-input" [ngModel]="projects.isPinned(sel.project)" (ngModelChange)="sel.project.pinned = $event; save()"></div>
                    </div>

                    <h4>Tabs</h4>
                    <table class="table table-sm ps-tabs">
                        <tr><th class="w-40px"></th><th>Title</th><th class="w-100px">Kind</th><th>Command</th><th class="w-60px" title="Open when the project opens">Auto</th><th class="w-40px"></th></tr>
                        <tr *ngFor="let t of sel.project.tabs; let i = index">
                            <td><button class="btn btn-sm btn-link" (click)="iconRow = iconRow === t ? null : t"><proj-icon [icon]="t.icon || defaultTabIcon(t)"></proj-icon></button></td>
                            <td><input class="form-control form-control-sm" [(ngModel)]="t.title" (ngModelChange)="save()"></td>
                            <td><select class="form-control form-control-sm" [(ngModel)]="t.kind" (ngModelChange)="save()"><option value="shell">Shell</option><option value="files">Files</option></select></td>
                            <td><input class="form-control form-control-sm mono" [disabled]="t.kind !== 'shell'" placeholder="claude" [(ngModel)]="t.command" (ngModelChange)="save()"></td>
                            <td><input type="checkbox" class="form-check-input" [(ngModel)]="t.autoOpen" (ngModelChange)="save()"></td>
                            <td><button class="btn btn-sm btn-link" (click)="sel.project.tabs.splice(i, 1); save()" [innerHTML]="ui.trash"></button></td>
                        </tr>
                        <tr *ngIf="iconRow"><td colspan="6"><icon-picker [value]="iconRow.icon" (valueChange)="iconRow.icon = $event; save()"></icon-picker></td></tr>
                    </table>
                    <button class="btn btn-sm btn-secondary" (click)="addTab(sel.project)">Add tab</button>

                    <div class="mt-4"><button class="btn btn-sm btn-danger" (click)="removeProject(sel.project)">Remove project</button></div>
                </ng-container>
            </div>
        </div>
    `,
    styles: [`
        .ps { display: flex; gap: 20px; min-height: 400px; }
        .ps-side { width: 230px; flex: none; }
        .ps-main { flex: 1; min-width: 0; }
        .ps-side-h { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--theme-fg-more-2); margin: 14px 0 4px; }
        .ps-side-group { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--theme-fg-more-2); padding: 4px 6px; border-radius: 4px; cursor: pointer; }
        .ps-side-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--theme-fg-more); }
        .ps-indent { padding-left: 22px; }
        .ps-side-item:hover, .ps-side-group:hover { background: var(--theme-bg-more-2); }
        .ps-side-item.active, .ps-side-group.active { background: var(--theme-bg-more-2); color: var(--theme-fg); }
        .ps-side-item ::ng-deep svg { width: 14px; height: 14px; }
        .ps-sw { width: 8px; height: 8px; border-radius: 2px; background: var(--theme-fg-more-2); }
        .ps-project-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .ps-project-head h3 { margin: 0; }
        .ps-big-icon { width: 36px; height: 36px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; color: #000; }
        .form-line { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .form-line > label { font-size: 12px; color: var(--theme-fg-more-2); }
        .form-line > input[type=checkbox] { margin: 0; }
        .ps-colors { display: flex; align-items: center; gap: 8px; }
        .ps-color { width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
        .ps-color.active { border-color: var(--theme-fg); }
        .mono { font-family: monospace; }
        .w-100px { width: 100px; } .w-60px { width: 60px; } .w-40px { width: 40px; }
        .ps-tabs td, .ps-tabs th { vertical-align: middle; }
        h4 { margin-top: 24px; }
    `],
})
export class ProjectsSettingsComponent implements OnInit {
    sel: Selection = { kind: 'general' }
    profiles: PartialProfile<Profile>[] = []
    openWithRows: { ext: string, program: string }[] = []
    iconRow: ProjectTabSpec | null = null
    ui = UI
    palette = ['#5da9f6', '#b1e969', '#e86aff', '#ebd99c', '#ff615a', '#82fff7', '#f5a623', '#ffffff']

    constructor (
        public projects: ProjectsService,
        public opener: ProjectOpenerService,
        private app: AppService,
    ) { }

    get cfg (): ProjectsConfig { return this.projects.cfg }

    async ngOnInit (): Promise<void> {
        this.profiles = await this.projects.allProfiles()
        this.openWithRows = Object.entries(this.cfg.openWith ?? {}).map(([ext, program]) => ({ ext, program }))
        const wanted = (window as any).__tabbyProjectsSelect as string | null | undefined
        if (wanted) {
            const p = this.projects.find(wanted)
            if (p) this.sel = { kind: 'project', project: p }
            ;(window as any).__tabbyProjectsSelect = null
        }
    }

    isSel (kind: 'group' | 'project', obj: any): boolean {
        return this.sel.kind === kind && ((this.sel as any).group === obj || (this.sel as any).project === obj)
    }

    groupsWithProjects (): { group: ProjectGroup | null, projects: Project[] }[] {
        const out: { group: ProjectGroup | null, projects: Project[] }[] = this.cfg.groups.map(g => ({ group: g, projects: this.cfg.items.filter(p => p.group === g.id) }))
        const loose = this.cfg.items.filter(p => !this.projects.group(p.group))
        if (loose.length) out.push({ group: null, projects: loose })
        return out
    }

    save (): void {
        this.projects.save()
    }

    saveOpenWith (): void {
        const map: Record<string, string> = {}
        for (const r of this.openWithRows) {
            const ext = r.ext.trim().replace(/^\./, '').toLowerCase()
            if (ext && r.program.trim()) map[ext] = r.program.trim()
        }
        this.cfg.openWith = map
        this.save()
    }

    addProject (): void {
        const p = this.projects.newProject()
        this.sel = { kind: 'project', project: p }
    }

    removeProject (p: Project): void {
        const t = this.opener.findOpen(p.id)
        if (t) this.app.closeTab(t, true)
        this.projects.removeProject(p)
        this.sel = { kind: 'general' }
    }

    addGroup (): void {
        const g = this.projects.newGroup()
        this.sel = { kind: 'group', group: g }
    }

    removeGroup (g: ProjectGroup): void {
        for (const p of this.cfg.items) if (p.group === g.id) p.group = null
        this.cfg.groups = this.cfg.groups.filter(x => x.id !== g.id)
        this.save()
        this.sel = { kind: 'general' }
    }

    addTab (p: Project): void {
        p.tabs.push({ id: uid(), title: 'Shell', kind: 'shell', command: null, autoOpen: false })
        this.save()
    }

    defaultTabIcon (t: ProjectTabSpec): string {
        return builtinIcon(t.kind === 'files' ? 'folder' : 'terminal')
    }
}
