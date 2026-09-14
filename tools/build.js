const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

// Automatically sync/increment version when building on release tag or local release build
if(process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    const tagVersion = process.env.GITHUB_REF_NAME.replace(/^v/, '')
    if(tagVersion && pkg.version !== tagVersion) {
        console.log(`[build.js] Synchronizing package.json version from tag: ${pkg.version} -> ${tagVersion}`)
        pkg.version = tagVersion
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
} else if(process.env.AUTO_BUMP === 'true') {
    const parts = pkg.version.split('.')
    if(parts.length === 3 && !isNaN(Number(parts[2]))) {
        parts[2] = String(Number(parts[2]) + 1)
        const nextVersion = parts.join('.')
        console.log(`[build.js] Auto-bumping package.json patch version: ${pkg.version} -> ${nextVersion}`)
        pkg.version = nextVersion
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
}

const executable = path.join(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)
const args = ['build']

if(process.env.GITHUB_REF_TYPE === 'tag') {
    args.push('--publish', 'always')
}

const result = spawnSync(executable, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
})

process.exit(result.status ?? 1)
