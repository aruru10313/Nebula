const path = require('path')
const { spawnSync } = require('child_process')

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
