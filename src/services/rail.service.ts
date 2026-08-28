import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, createComponent } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { RailComponent } from '../components/rail.component'

const STYLE_ID = 'tabby-projects-style'

/**
 * Tabby has no sidebar extension point, so the rail is created dynamically and slotted
 * into `app-root .window` next to the main content. Purely additive; removing the plugin
 * leaves Tabby untouched.
 */
@Injectable({ providedIn: 'root' })
export class RailService {
    private ref: ComponentRef<RailComponent> | null = null

    constructor (
        private appRef: ApplicationRef,
        private env: EnvironmentInjector,
        private config: ConfigService,
    ) { }

    start (): void {
        const started = Date.now()
        const attempt = (): void => {
            const content = document.querySelector('app-root .window > .content.main')
            if (content) {
                this.mount(content as HTMLElement)
            } else if (Date.now() - started < 30_000) {
                setTimeout(attempt, 250)
            }
        }
        attempt()
        this.config.changed$.subscribe(() => this.apply())
    }

    private mount (content: HTMLElement): void {
        if (this.ref) return
        this.ref = createComponent(RailComponent, { environmentInjector: this.env })
        this.appRef.attachView(this.ref.hostView)
        content.parentElement!.insertBefore(this.ref.location.nativeElement, content)
        this.apply()
    }

    apply (): void {
        const cfg = this.config.store.projects
        const show = !!cfg?.showRail
        if (this.ref) {
            (this.ref.location.nativeElement as HTMLElement).style.display = show ? '' : 'none'
        }
        let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
        if (!style) {
            style = document.createElement('style')
            style.id = STYLE_ID
            document.head.appendChild(style)
        }
        style.textContent = show && cfg.hideTabBar
            ? 'app-root .window > .content.main > .tab-bar { display: none !important; }'
            : ''
    }

    toggle (): void {
        const cfg = this.config.store.projects
        if (!cfg.showRail) {
            cfg.showRail = true
        } else {
            cfg.collapsed = !cfg.collapsed
        }
        this.config.save()
    }
}
