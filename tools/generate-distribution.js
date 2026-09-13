const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const minecraftVersion = '1.20.1'
const forgeVersion = '47.4.23'
const root = path.resolve(__dirname, '..', '..')
const outputRoot = path.join(__dirname, '..', 'distribution')
const stateFile = path.join(outputRoot, '.distribution-state.json')
const sourceMods = process.env.NEBULA_MODS_DIR || path.join(root, 'mods')
const baseUrl = (process.env.NEBULA_ASSET_BASE_URL || 'https://mc.aruru.kr/nebula').replace(/\/+$/, '')
const serverAddress = process.env.NEBULA_SERVER_ADDRESS || 'comet.aruru.kr:25565'

const excludedMods = new Set([
    'economy-server-mod-1.0.0.jar',
    'fabric-api-0.92.2+1.20.1.jar'
])

function hashFile(file) {
    const data = fs.readFileSync(file)
    return {
        size: data.length,
        MD5: crypto.createHash('md5').update(data).digest('hex')
    }
}

function getModSnapshot(files) {
    return files.map(file => {
        const info = hashFile(path.join(sourceMods, file))
        return `${file}:${info.size}:${info.MD5}`
    }).join('|')
}

function getRevision(snapshot) {
    let previous = null
    if(fs.existsSync(stateFile)) {
        previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    }
    if(previous?.snapshot === snapshot) {
        return previous.revision
    }
    const revision = (previous?.revision || 0) + 1
    fs.mkdirSync(outputRoot, { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify({ revision, snapshot }, null, 2))
    return revision
}

function moduleForMod(fileName) {
    const source = path.join(sourceMods, fileName)
    const target = path.join(outputRoot, 'servers', 'Nebula-1.20.1', 'mods', fileName)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    const safeId = fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const hash = hashFile(source)
    return {
        id: `nebula:server-mod:${safeId}`,
        name: fileName,
        type: 'ForgeMod',
        artifact: {
            ...hash,
            path: fileName,
            url: `${baseUrl}/servers/Nebula-1.20.1/mods/${encodeURIComponent(fileName)}`
        }
    }
}

function forgeModule() {
    const forgeInstaller = path.join(root, `forge-${minecraftVersion}-${forgeVersion}-installer.jar`)
    const versionJson = JSON.parse(execFileSync('unzip', ['-p', forgeInstaller, 'version.json'], { encoding: 'utf8' }))
    const forgeVersionJson = path.join(outputRoot, 'repo', 'versions', `${minecraftVersion}-forge-${forgeVersion}.json`)
    fs.mkdirSync(path.dirname(forgeVersionJson), { recursive: true })
    fs.writeFileSync(forgeVersionJson, JSON.stringify(versionJson, null, 2))
    const versionHash = hashFile(forgeVersionJson)

    const forgeLibraries = versionJson.libraries
        .filter(library => library.downloads?.artifact?.url)
        .map(library => {
            const artifact = library.downloads.artifact
            const localFile = path.join(root, 'libraries', artifact.path)
            const localArtifact = fs.existsSync(localFile) ? hashFile(localFile) : null
            if(localArtifact != null) {
                const target = path.join(outputRoot, 'repo', 'lib', artifact.path)
                fs.mkdirSync(path.dirname(target), { recursive: true })
                fs.copyFileSync(localFile, target)
            }
            return {
                id: library.name,
                name: `Minecraft Forge (${library.name.split(':')[1]})`,
                type: 'Library',
                classpath: true,
                artifact: {
                    size: artifact.size,
                    ...(localArtifact || {}),
                    path: artifact.path,
                    url: localArtifact != null ? `${baseUrl}/repo/lib/${artifact.path}` : artifact.url
                }
            }
        })

    const rootPath = `net/minecraftforge/lowcodelanguage/${minecraftVersion}-${forgeVersion}/lowcodelanguage-${minecraftVersion}-${forgeVersion}.jar`
    const rootFile = path.join(root, 'libraries', rootPath)
    const rootArtifact = fs.existsSync(rootFile) ? hashFile(rootFile) : { size: 0 }
    if(fs.existsSync(rootFile)) {
        const target = path.join(outputRoot, 'repo', 'lib', rootPath)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(rootFile, target)
    }

    return {
        id: `net.minecraftforge:lowcodelanguage:${minecraftVersion}-${forgeVersion}`,
        name: `Minecraft Forge ${minecraftVersion}-${forgeVersion}`,
        type: 'ForgeHosted',
        artifact: {
            ...rootArtifact,
            path: rootPath,
            url: fs.existsSync(rootFile)
                ? `${baseUrl}/repo/lib/${rootPath}`
                : `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${minecraftVersion}-${forgeVersion}/lowcodelanguage-${minecraftVersion}-${forgeVersion}.jar`
        },
        subModules: [
            {
                id: `${minecraftVersion}-${forgeVersion}`,
                name: 'Minecraft Forge (version.json)',
                type: 'VersionManifest',
                artifact: {
                    ...versionHash,
                    url: `${baseUrl}/repo/versions/${minecraftVersion}-forge-${forgeVersion}.json`
                }
            },
            ...forgeLibraries
        ]
    }
}

function main() {
    const files = fs.readdirSync(sourceMods)
        .filter(file => file.endsWith('.jar') && !excludedMods.has(file))
        .sort()
    const snapshot = getModSnapshot(files)
    const revision = getRevision(snapshot)
    const generatedModsRoot = path.join(outputRoot, 'servers', 'Nebula-1.20.1', 'mods')
    fs.rmSync(generatedModsRoot, { recursive: true, force: true })
    const iconTarget = path.join(outputRoot, 'servers', 'Nebula-1.20.1', 'icon.png')
    fs.copyFileSync(path.join(__dirname, '..', 'app', 'assets', 'images', 'nebula-icon.png'), iconTarget)

    const distribution = {
        version: `1.0.${revision}`,
        rss: `${baseUrl}/rss.xml`,
        servers: [{
            id: 'Nebula-1.20.1',
            name: 'Nebula Survival',
            description: `Nebula Minecraft ${minecraftVersion} / Forge ${forgeVersion}`,
            icon: `${baseUrl}/servers/Nebula-1.20.1/icon.png`,
            version: `1.0.${revision}`,
            address: serverAddress,
            minecraftVersion,
            discord: {
                shortId: 'Nebula',
                largeImageText: 'Nebula Survival',
                largeImageKey: 'nebula'
            },
            mainServer: true,
            autoconnect: true,
            javaOptions: {
                supported: '>=17',
                suggestedMajor: 17,
                ram: { recommended: 4096, minimum: 2048 }
            },
            modules: [forgeModule(), ...files.map(moduleForMod)]
        }]
    }

    fs.mkdirSync(outputRoot, { recursive: true })
    fs.writeFileSync(path.join(outputRoot, 'distribution.json'), JSON.stringify(distribution, null, 2))
    console.log(`Generated ${files.length} Forge mods for Minecraft ${minecraftVersion} / Forge ${forgeVersion}.`)
    console.log(`Distribution: ${path.join(outputRoot, 'distribution.json')}`)
}

main()
