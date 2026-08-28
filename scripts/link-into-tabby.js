// Links this checkout into Tabby's user plugin folder so Tabby loads it on next start.
//   node scripts/link-into-tabby.js           # create the link
//   node scripts/link-into-tabby.js --remove  # remove it
// Tabby scans <userData>/plugins/node_modules/tabby-* for package.json with keyword "tabby-plugin".
const fs = require('fs')
const os = require('os')
const path = require('path')

function tabbyPluginsDir () {
    if (process.platform === 'win32') return path.join(process.env.APPDATA, 'tabby', 'plugins')
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'tabby', 'plugins')
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'tabby', 'plugins')
}

const repo = path.resolve(__dirname, '..')
const nodeModules = path.join(tabbyPluginsDir(), 'node_modules')
const link = path.join(nodeModules, 'tabby-projects')

if (process.argv.includes('--remove')) {
    if (fs.existsSync(link)) { fs.rmSync(link, { recursive: true, force: true }); console.log('removed', link) }
    else console.log('nothing to remove at', link)
    process.exit(0)
}

fs.mkdirSync(nodeModules, { recursive: true })
if (fs.existsSync(link)) {
    const st = fs.lstatSync(link)
    if (st.isSymbolicLink() || fs.existsSync(path.join(link, 'package.json'))) {
        fs.rmSync(link, { recursive: true, force: true })
    }
}
// 'junction' works on Windows without admin rights; on other platforms it's a plain symlink.
fs.symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir')
console.log(`linked ${link} -> ${repo}`)
console.log('Restart Tabby to load the plugin. Build first with: npm run build')
