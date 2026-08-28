import { AfterViewInit, Component, ComponentRef, Injector, Input, ViewChild, ViewContainerRef } from '@angular/core'
import { BaseTabComponent, GetRecoveryTokenOptions, RecoveryToken } from 'tabby-core'
import { SFTPPanelComponent } from 'tabby-ssh'
import { FILES_TAB_TOKEN_TYPE } from '../api'
import { builtinIcon } from '../icons'
import { LocalEditService } from '../services/localEdit.service'
import type { ProjectTabComponent } from './projectTab.component'

/**
 * A child tab that hosts Tabby's own SFTP panel, bound to the SSH session of a sibling
 * terminal in the same project. Double-clicking a file opens it locally with sync-back.
 */
@Component({
    selector: 'project-files-tab',
    template: `
        <div class="pf-host"><ng-container #vc></ng-container></div>
        <div class="pf-wait" *ngIf="waiting">
            <div *ngIf="!failed">Waiting for an SSH session in this project…</div>
            <div *ngIf="failed">No SSH session found. Open a shell tab in this project first, then reopen Files.</div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; width: 100%; height: 100%; }
        .pf-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .pf-host ::ng-deep sftp-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .pf-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--theme-fg-more-2); text-align: center; padding: 20px; }
    `],
})
export class FilesTabComponent extends BaseTabComponent implements AfterViewInit {
    @Input() projectTab: ProjectTabComponent | null = null
    @Input() path = '/'
    @ViewChild('vc', { read: ViewContainerRef }) viewContainer: ViewContainerRef

    waiting = true
    failed = false
    private panel: ComponentRef<SFTPPanelComponent> | null = null
    private localEdit: LocalEditService

    constructor (injector: Injector) {
        super(injector)
        this.localEdit = injector.get(LocalEditService)
        this.setTitle('Files')
        this.icon = builtinIcon('folder')
    }

    ngAfterViewInit (): void {
        const started = Date.now()
        const tryMount = (): void => {
            if (this._destroyCalledFlag) return
            const session = this.projectTab?.getSSHSession()
            if (session) {
                this.mount(session)
            } else if (Date.now() - started > 60_000) {
                this.failed = true
            } else {
                setTimeout(tryMount, 500)
            }
        }
        tryMount()
    }

    private get _destroyCalledFlag (): boolean {
        return (this as any)._destroyCalled === true
    }

    private mount (session: any): void {
        this.panel = this.viewContainer.createComponent(SFTPPanelComponent)
        const inst = this.panel.instance
        inst.session = session
        inst.path = this.path
        inst.pathChange.subscribe((p: string) => { this.path = p })
        inst.closed.subscribe(() => this.destroy())

        // Double-click on a file → edit locally instead of Tabby's default download-to-disk.
        const originalOpen = inst.open.bind(inst)
        inst.open = async (item: any) => {
            if (item.isDirectory) return originalOpen(item)
            await this.localEdit.editRemote(session, item)
        }

        this.panel.changeDetectorRef.detectChanges()
        this.waiting = false
    }

    async getRecoveryToken (_options?: GetRecoveryTokenOptions): Promise<RecoveryToken | null> {
        return { type: FILES_TAB_TOKEN_TYPE, path: this.path, tabIcon: this.icon }
    }

    destroy (skipDestroyedEvent = false): void {
        this.panel?.destroy()
        this.panel = null
        super.destroy(skipDestroyedEvent)
    }
}
