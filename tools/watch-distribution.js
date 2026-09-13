const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const sourceMods = process.env.NEBULA_MODS_DIR || path.resolve(projectRoot, '..', 'mods')
const deployDir = process.env.NEBULA_DEPLOY_DIR
const interval = Number(process.env.NEBULA_WATCH_INTERVAL || 10000)
const generator = path.join(__dirname, 'generate-distribution.js')

function snapshot() {
    return fs.readdirSync(sourceMods)
        .filter(file => file.endsWith('.jar'))
        .sort()
        .map(file => {
            const stat = fs.statSync(path.join(sourceMods, file))
            return `${file}:${stat.size}:${stat.mtimeMs}`
        })
        .join('|')
}

function syncDistribution() {
    const result = spawnSync(process.execPath, [generator], {
        cwd: projectRoot,
        env: process.env,
        stdio: 'inherit'
    })
    if(result.status !== 0) {
        throw new Error(`Distribution generation failed with exit code ${result.status}.`)
    }

    if(deployDir) {
        fs.mkdirSync(deployDir, { recursive: true })
        for(const entry of fs.readdirSync(deployDir)) {
            fs.rmSync(path.join(deployDir, entry), { recursive: true, force: true })
        }
        fs.cpSync(path.join(projectRoot, 'distribution'), deployDir, { recursive: true, force: true })
        console.log(`Synced Nebula distribution to ${deployDir}`)
    }
}

let lastSnapshot = ''
function check() {
    const nextSnapshot = snapshot()
    if(nextSnapshot === lastSnapshot) {
        return
    }
    lastSnapshot = nextSnapshot
    console.log('Detected a client mod change. Rebuilding Nebula server pack...')
    syncDistribution()
}

console.log(`Watching client mods: ${sourceMods}`)
if(deployDir) {
    console.log(`Automatic deployment enabled: ${deployDir}`)
}
check()
setInterval(check, interval)
