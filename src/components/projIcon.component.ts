import { Component, Input } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

/** Renders a Tabby-style icon: a Font Awesome class string, or raw `<svg>`/`<img>` markup. */
@Component({
    selector: 'proj-icon',
    template: `
        <i *ngIf="!isHtml" class="fa-fw {{ icon }}" [style.color]="color"></i>
        <span *ngIf="isHtml" class="proj-icon-html" [style.color]="color" [innerHTML]="html"></span>
    `,
    styles: [`
        :host { display: inline-flex; align-items: center; justify-content: center; width: 1.25em; height: 1em; line-height: 1; flex: none; }
        .proj-icon-html { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; }
        .proj-icon-html ::ng-deep svg, .proj-icon-html ::ng-deep img { width: 1em; height: 1em; display: block; }
    `],
})
export class ProjIconComponent {
    @Input() icon: string | null | undefined
    @Input() color: string | null | undefined

    constructor (private sanitizer: DomSanitizer) { }

    get isHtml (): boolean {
        return !!this.icon && this.icon.trim().startsWith('<')
    }

    get html (): SafeHtml {
        return this.sanitizer.bypassSecurityTrustHtml(this.icon ?? '')
    }
}
