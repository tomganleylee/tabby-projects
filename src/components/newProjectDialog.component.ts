import { Component, Injector, OnInit } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { NotificationsService, PartialProfile, PlatformService, Profile, ProfilesService } from 'tabby-core'
import type { PasswordStorageService } from 'tabby-ssh/typings/services/passwordStorage.service'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Project, ProjectTabSpec, uid } from '../api'
import { builtinIcon } from '../icons'
import { ProjectOpenerService } from '../services/opener.service'
import { ProjectsService } from '../services/projects.service'

type HostMode = 'existing' | 'newssh'

/** "New project" dialog: pick a host (or define a new SSH server inline), directory, tabs. */
@Component({
    selector: 'new-project-dialog',
    template: `
        <div class="modal-header">
            <h5 class="modal-title">New project</h5>
            <button type="button" class="btn-close" (click)="modal.dismiss()"></button>
        </div>
        <div class="modal-body np">
            <div class="row">
                <div class="col-8 form-line"><label>Project name</label><input class="form-control" [(ngModel)]="name" placeholder="My API" autofocus></div>
                <div class="col-4 form-line"><label>Group</label>
                    <select class="form-control" [(ngModel)]="group">
                        <option [ngValue]="null">Ungrouped</option>
                        <option *ngFor="let g of projects.cfg.groups" [ngValue]="g.id">{{ g.name }}</option>
                    </select>
                </div>
            </div>

            <label>Runs on</label>
            <div class="np-seg">
                <button [class.active]="hostMode === 'existing'" (click)="hostMode = 'existing'">Existing host / shell</button>
                <button [class.active]="hostMode === 'newssh'" (click)="hostMode = 'newssh'">New SSH server</button>
            </div>

            <ng-container *ngIf="hostMode === 'existing'">
                <div class="form-line">
                    <select class="form-control" [(ngModel)]="profileId" (ngModelChange)="onProfileChange()">
                        <option [ngValue]="null">— choose a profile —</option>
                        <optgroup label="SSH">
                            <option *ngFor="let p of sshProfiles" [ngValue]="p.id">{{ p.name }} <ng-container *ngIf="p.options?.host">({{ p.options.user }}@{{ p.options.host }})</ng-container></option>
                        </optgroup>
                        <optgroup label="Local shells">
                            <option *ngFor="let p of localProfiles" [ngValue]="p.id">{{ p.name }}</option>
                        </optgroup>
                    </select>
                </div>
            </ng-container>

            <ng-container *ngIf="hostMode === 'newssh'">
                <div class="row">
                    <div class="col-6 form-line"><label>Host</label><input class="form-control mono" [(ngModel)]="ssh.host" placeholder="192.168.1.20 or dev.example.com"></div>
                    <div class="col-3 form-line"><label>User</label><input class="form-control mono" [(ngModel)]="ssh.user"></div>
                    <div class="col-3 form-line"><label>Port</label><input class="form-control mono" type="number" [(ngModel)]="ssh.port"></div>
                </div>
                <div class="row">
                    <div class="col-4 form-line"><label>Auth</label>
                        <select class="form-control" [(ngModel)]="ssh.auth">
                            <option value="publicKey">Private key</option>
                            <option value="password">Password</option>
                            <option value="agent">SSH agent</option>
                        </select>
                    </div>
                    <div class="col-8 form-line" *ngIf="ssh.auth === 'publicKey'"><label>Key file</label>
                        <div class="np-inline"><input class="form-control mono" [(ngModel)]="ssh.keyPath"><button class="btn btn-secondary" (click)="pickKey()">Browse</button></div>
                    </div>
                    <div class="col-8 form-line" *ngIf="ssh.auth === 'password'"><label>Password <small>(stored in Tabby's vault)</small></label><input class="form-control" type="password" [(ngModel)]="ssh.password"></div>
                </div>
                <div class="form-line"><label>Save server as <small>(Tabby profile name)</small></label><input class="form-control" [(ngModel)]="ssh.name" [placeholder]="ssh.host || 'Dev server'"></div>
            </ng-container>

            <div class="form-line"><label>Working directory</label>
                <div class="np-inline">
                    <input class="form-control mono" [(ngModel)]="cwd" [placeholder]="isLocal ? 'C:\\\\Projects\\\\my-api' : '/srv/my-api'">
                    <button class="btn btn-secondary" *ngIf="isLocal" (click)="pickDir()">Browse</button>
                </div>
            </div>

            <label>Tabs</label>
            <div class="np-tabs">
                <label class="np-check"><input type="checkbox" class="form-check-input" [(ngModel)]="wantClaude"> Claude
                    <input class="form-control form-control-sm mono np-cmd" [(ngModel)]="claudeCommand" [disabled]="!wantClaude" placeholder="command"></label>
                <label class="np-check"><input type="checkbox" class="form-check-input" [(ngModel)]="wantShell"> Shell</label>
                <label class="np-check" *ngIf="!isLocal"><input type="checkbox" class="form-check-input" [(ngModel)]="wantFiles"> Files (SFTP)</label>
            </div>

            <div class="form-line mt-3"><label>Icon</label><icon-picker [value]="icon" [color]="color" (valueChange)="icon = $event"></icon-picker></div>
            <div class="np-error" *ngIf="error">{{ error }}</div>
        </div>
        <div class="modal-footer">
            <label class="np-check me-auto"><input type="checkbox" class="form-check-input" [(ngModel)]="openNow"> Open now</label>
            <button class="btn btn-secondary" (click)="modal.dismiss()">Cancel</button>
            <button class="btn btn-primary" (click)="save()" [disabled]="busy">Create project</button>
        </div>
    `,
    styles: [`
        .np label { font-size: 12px; color: var(--theme-fg-more-2); }
        .form-line { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .np-seg { display: flex; gap: 4px; margin: 4px 0 12px; }
        .np-seg button { border: 1px solid var(--theme-bg-more-2); background: transparent; color: var(--theme-fg-more); padding: 6px 12px; border-radius: 5px; cursor: pointer; }
        .np-seg button.active { background: var(--theme-bg-more-2); color: var(--theme-fg); }
        .np-inline { display: flex; gap: 6px; }
        .np-inline input { flex: 1; }
        .np-tabs { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 4px; }
        .np-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px !important; color: var(--theme-fg) !important; }
        .np-cmd { width: 160px; margin-left: 4px; }
        .mono { font-family: monospace; }
        .np-error { color: #ff615a; font-size: 13px; margin-top: 8px; }
    `],
})
export class NewProjectDialogComponent implements OnInit {
    name = ''
    group: string | null = null
    hostMode: HostMode = 'existing'
    profiles: PartialProfile<any>[] = []
    profileId: string | null = null
    ssh = { name: '', host: '', user: 'root', port: 22, auth: 'publicKey' as 'publicKey' | 'password' | 'agent', keyPath: '', password: '' }
    cwd = ''
    wantClaude = true
    claudeCommand = 'claude'
    wantShell = true
    wantFiles = true
    icon: string | null = builtinIcon('folder')
    color: string | null = null
    openNow = true
    busy = false
    error = ''

    constructor (
        public modal: NgbActiveModal,
        public projects: ProjectsService,
        private profilesService: ProfilesService,
        private injector: Injector,
        private opener: ProjectOpenerService,
        private platform: PlatformService,
        private notifications: NotificationsService,
    ) { }

    async ngOnInit (): Promise<void> {
        this.profiles = await this.projects.allProfiles()
        this.group = this.projects.cfg.groups[0]?.id ?? null
        for (const k of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
            const p = path.join(os.homedir(), '.ssh', k)
            if (fs.existsSync(p)) { this.ssh.keyPath = p; break }
        }
        if (!this.sshProfiles.length && this.localProfiles.length === 0) this.hostMode = 'newssh'
    }

    get sshProfiles (): PartialProfile<any>[] { return this.profiles.filter(p => p.type === 'ssh') }
    get localProfiles (): PartialProfile<any>[] { return this.profiles.filter(p => p.type === 'local') }

    get isLocal (): boolean {
        if (this.hostMode === 'newssh') return false
        return this.profiles.find(p => p.id === this.profileId)?.type === 'local'
    }

    onProfileChange (): void {
        const p = this.profiles.find(x => x.id === this.profileId)
        if (p && !this.name) this.name = p.name
        if (p?.type === 'local') this.wantFiles = false
    }

    async pickDir (): Promise<void> {
        try {
            const dir = await this.platform.pickDirectory()
            if (dir) this.cwd = dir
        } catch { /* cancelled */ }
    }

    pickKey (): void {
        const input = document.createElement('input')
        input.type = 'file'
        input.onchange = () => {
            const f: any = input.files?.[0]
            if (f?.path) this.ssh.keyPath = f.path
        }
        input.click()
    }

    async save (): Promise<void> {
        this.error = ''
        if (!this.name.trim()) { this.error = 'Give the project a name.'; return }
        let profileId = this.profileId
        this.busy = true
        try {
            if (this.hostMode === 'newssh') {
                if (!this.ssh.host.trim()) { this.error = 'Host is required.'; return }
                const profile: any = {
                    type: 'ssh',
                    name: this.ssh.name.trim() || this.ssh.host.trim(),
                    icon: 'fas fa-server',
                    color: this.color,
                    disableDynamicTitle: true,
                    options: {
                        host: this.ssh.host.trim(),
                        port: Number(this.ssh.port) || 22,
                        user: this.ssh.user.trim() || 'root',
                        auth: this.ssh.auth,
                        privateKeys: this.ssh.auth === 'publicKey' && this.ssh.keyPath ? [this.ssh.keyPath] : [],
                        keepaliveInterval: 60000,
                        keepaliveCountMax: 3,
                        reuseSession: true,
                        algorithms: {},
                        forwardedPorts: [],
                        scripts: [],
                        input: {},
                    },
                }
                await this.profilesService.newProfile(profile)
                if (this.ssh.auth === 'password' && this.ssh.password) {
                    // Not in the published typings index, but exported at runtime by tabby-ssh.
                    const passwords: PasswordStorageService = this.injector.get(require('tabby-ssh').PasswordStorageService)
                    await passwords.savePassword(profile, this.ssh.password)
                }
                profileId = profile.id
                this.notifications.info(`Saved SSH profile "${profile.name}"`)
            } else if (!profileId) {
                this.error = 'Choose a host profile.'
                return
            }

            const tabs: ProjectTabSpec[] = []
            if (this.wantClaude) tabs.push({ id: uid(), title: 'Claude', kind: 'shell', command: this.claudeCommand.trim() || 'claude', icon: builtinIcon('robot'), autoOpen: true })
            if (this.wantShell) tabs.push({ id: uid(), title: 'Shell', kind: 'shell', icon: builtinIcon('terminal'), autoOpen: true })
            if (this.wantFiles && !this.isLocal) tabs.push({ id: uid(), title: 'Files', kind: 'files', icon: builtinIcon('folder'), autoOpen: false })

            const project: Project = this.projects.newProject({
                name: this.name.trim(),
                group: this.group,
                icon: this.icon,
                color: this.color,
                profile: profileId,
                cwd: this.cwd.trim() || null,
                tabs,
            })
            this.modal.close(project)
            if (this.openNow) this.opener.open(project)
        } catch (e: any) {
            this.error = e?.message ?? String(e)
        } finally {
            this.busy = false
        }
    }
}
