const fs = require('node:fs')
const path = require('node:path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const root = path.resolve(__dirname, '..')
const assets = path.join(root, 'admin-dist', 'assets')
const scripts = fs.readdirSync(assets).filter((name) => name.endsWith('.js'))

for (const name of scripts) {
    const file = path.join(assets, name)
    const source = fs.readFileSync(file, 'utf8')
    const obfuscated = JavaScriptObfuscator.obfuscate(source, {
        compact: true,
        controlFlowFlattening: true,
        deadCodeInjection: false,
        identifierNamesGenerator: 'hexadecimal',
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75
    }).getObfuscatedCode()
    fs.writeFileSync(file, `${obfuscated}\n`)
}

console.log(`Built React/Vite admin bundle (${scripts.length} JavaScript assets)`)
