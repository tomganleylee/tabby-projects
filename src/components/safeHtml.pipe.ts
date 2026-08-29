import { Pipe, PipeTransform } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'

/**
 * Angular's sanitizer strips inline `<svg>` from `[innerHTML]`, which would make every
 * plugin glyph vanish. The plugin's own icon strings are trusted, so mark them as such.
 */
@Pipe({ name: 'safeHtml' })
export class SafeHtmlPipe implements PipeTransform {
    constructor (private sanitizer: DomSanitizer) { }

    transform (value: string | null | undefined): SafeHtml {
        return this.sanitizer.bypassSecurityTrustHtml(value ?? '')
    }
}
