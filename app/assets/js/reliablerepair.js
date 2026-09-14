const fs = require('fs-extra')
const { createWriteStream } = require('fs')
const { pipeline } = require('stream/promises')
const childProcess = require('child_process')
const os = require('os')
const path = require('path')
const got = require('got')
const { EventEmitter } = require('events')
const { LoggerUtil } = require('helios-core')
const { DistributionIndexProcessor } = require('helios-core/dl')
const { MojangIndexProcessor } = require('helios-core/dl')
const { validateLocalFile } = require('helios-core/common')
const ConfigManager = require('./configmanager')

const logger = LoggerUtil.getLogger('ReliableRepair')
const DOWNLOAD_CONCURRENCY = 4
const MAX_RETRIES = 5
const REQUEST_TIMEOUT_MS = 60000
const FORGE_INSTALLER_TIMEOUT_MS = 180000
const FORGE_INSTALLER_SHA1 = 'ed31ce02ac69176f34353235cb2508d5a0f1e088'

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

function assetLabel(asset) {
    return asset.id || asset.path
}

async function downloadAsset(asset, onProgress) {
    const temporaryPath = `${asset.path}.download`

    for(let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let transferred = 0
        logger.info(`[Download] Starting ${assetLabel(asset)} (attempt ${attempt}/${MAX_RETRIES})`)
        try {
            await fs.ensureDir(path.dirname(asset.path))
            await fs.remove(temporaryPath)

            const downloadStream = got.stream(asset.url, {
                retry: { limit: 0 },
                timeout: {
                    lookup: 10000,
                    connect: 10000,
                    secureConnect: 10000,
                    response: 30000,
                    request: REQUEST_TIMEOUT_MS
                }
            })
            const fileWriter = createWriteStream(temporaryPath)

            downloadStream.on('data', chunk => {
                transferred += chunk.length
                onProgress({ transferred, total: asset.size })
            })

            await pipeline(downloadStream, fileWriter)

            if(asset.size != null && transferred !== asset.size) {
                throw new Error(`Expected ${asset.size} bytes but received ${transferred}`)
            }
            if(!await validateLocalFile(temporaryPath, asset.algo, asset.hash)) {
                throw new Error('Downloaded file checksum did not match the distribution manifest')
            }

            await fs.move(temporaryPath, asset.path, { overwrite: true })
            logger.info(`[Download] Completed ${assetLabel(asset)} (${transferred} bytes)`)
            return transferred
        } catch (err) {
            await fs.remove(temporaryPath)
            onProgress({ transferred: 0, total: asset.size })
            logger.warn(`[Download] Failed ${assetLabel(asset)} on attempt ${attempt}/${MAX_RETRIES}: ${err.message}`)

            if(attempt === MAX_RETRIES) {
                logger.error(`[Download] Giving up on ${assetLabel(asset)}`)
                throw err
            }

            const delay = Math.min(1000 * (2 ** (attempt - 1)), 10000)
            logger.info(`[Download] Retrying ${assetLabel(asset)} in ${delay}ms`)
            await sleep(delay)
        }
    }
}

function getForgeModule(server) {
    return server.modules.find(module => module.rawModule.type === 'ForgeHosted' || module.rawModule.type === 'Forge')
}

function getForgeMcpVersion(modManifest) {
    const gameArguments = modManifest.arguments?.game || []
    const argumentIndex = gameArguments.indexOf('--fml.mcpVersion')
    return argumentIndex >= 0 ? gameArguments[argumentIndex + 1] : null
}

function forgeRuntimeAssets(commonDirectory, minecraftVersion, forgeVersion, mcpVersion) {
    const libraryDirectory = path.join(commonDirectory, 'libraries')
    const forgePath = path.join(
        libraryDirectory,
        'net/minecraftforge/forge',
        forgeVersion,
        `forge-${forgeVersion}-client.jar`
    )
    const clientDirectory = path.join(libraryDirectory, 'net/minecraft/client', `${minecraftVersion}-${mcpVersion}`)
    return [
        path.join(clientDirectory, `client-${minecraftVersion}-${mcpVersion}-srg.jar`),
        path.join(clientDirectory, `client-${minecraftVersion}-${mcpVersion}-extra.jar`),
        forgePath
    ]
}

function runForgeInstaller(javaExecutable, installerPath, installDirectory) {
    return new Promise((resolve, reject) => {
        const installer = childProcess.spawn(javaExecutable, [
            '-jar',
            installerPath,
            '--installClient',
            installDirectory
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        })
        let output = ''
        installer.stdout.on('data', data => {
            output += data.toString()
        })
        installer.stderr.on('data', data => {
            output += data.toString()
        })
        installer.on('error', reject)
        const timeout = setTimeout(() => {
            installer.kill()
            reject(new Error('Forge client installation timed out'))
        }, FORGE_INSTALLER_TIMEOUT_MS)
        installer.on('close', code => {
            clearTimeout(timeout)
            if(code === 0) {
                resolve()
            } else {
                reject(new Error(`Forge client installation failed with exit code ${code}: ${output.slice(-2000)}`))
            }
        })
    })
}

class ReliableRepair {

    constructor(commonDirectory, instanceDirectory, launcherDirectory, serverId, devMode, distribution) {
        this.commonDirectory = commonDirectory
        this.instanceDirectory = instanceDirectory
        this.launcherDirectory = launcherDirectory
        this.serverId = serverId
        this.devMode = devMode
        this.distribution = distribution
        this.processors = []
        this.assets = []
        this.childProcess = new EventEmitter()
    }

    spawnReceiver() {
        this.childProcess = new EventEmitter()
    }

    destroyReceiver() {
        this.childProcess.removeAllListeners()
    }

    async verifyFiles(onProgress) {
        const server = this.distribution?.getServerById(this.serverId)
        if(server == null) {
            throw new Error(`Invalid server id ${this.serverId}`)
        }

        const mojangIndexProcessor = new MojangIndexProcessor(
            this.commonDirectory,
            server.rawServer.minecraftVersion
        )
        const distributionIndexProcessor = new DistributionIndexProcessor(
            this.commonDirectory,
            this.distribution,
            this.serverId
        )
        this.processors = [mojangIndexProcessor, distributionIndexProcessor]

        let totalStages = 0
        for(const processor of this.processors) {
            await processor.init()
            totalStages += processor.totalStages()
        }

        await this.ensureForgeRuntime(server)

        const assets = []
        let completedStages = 0
        for(const processor of this.processors) {
            const result = await processor.validate(async () => {
                completedStages++
                onProgress(Math.trunc((completedStages / totalStages) * 100))
            })
            Object.values(result)
                .flatMap(stageAssets => stageAssets)
                .forEach(asset => assets.push(asset))
        }

        this.assets = assets
        logger.info(`[Download] Validation complete: ${assets.length} file(s) require download`)
        return assets.length
    }

    async ensureForgeRuntime(server) {
        const forgeModule = getForgeModule(server)
        if(forgeModule == null) {
            return
        }

        const forgeVersion = forgeModule.getMavenComponents().version
        const modManifest = await this.processors[1].loadModLoaderVersionJson(server)
        const mcpVersion = getForgeMcpVersion(modManifest)
        const minecraftVersion = server.rawServer.minecraftVersion
        if(mcpVersion == null || forgeVersion == null) {
            logger.warn('[Forge] Unable to resolve client runtime artifact versions.')
            return
        }

        const requiredPaths = forgeRuntimeAssets(
            this.commonDirectory,
            minecraftVersion,
            forgeVersion,
            mcpVersion
        )
        if(requiredPaths.every(requiredPath => fs.existsSync(requiredPath))) {
            return
        }

        const installerDirectory = path.join(os.tmpdir(), 'NebulaForgeInstall', forgeVersion)
        const installerPath = path.join(installerDirectory, `forge-${forgeVersion}-installer.jar`)
        await fs.ensureDir(installerDirectory)
        if(!await validateLocalFile(installerPath, 'sha1', FORGE_INSTALLER_SHA1)) {
            await downloadAsset({
                id: `Forge installer ${forgeVersion}`,
                url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`,
                path: installerPath,
                hash: FORGE_INSTALLER_SHA1,
                algo: 'sha1'
            }, () => {})
        }

        const installDirectory = path.join(installerDirectory, 'client')
        await fs.ensureDir(installDirectory)
        await fs.writeJson(path.join(installDirectory, 'launcher_profiles.json'), { profiles: {} })
        logger.info(`[Forge] Installing missing client runtime artifacts for ${forgeVersion}`)
        await runForgeInstaller(
            ConfigManager.getJavaExecutable(this.serverId),
            installerPath,
            installDirectory
        )
        await fs.copy(path.join(installDirectory, 'libraries'), path.join(this.commonDirectory, 'libraries'), { overwrite: true })

        if(!requiredPaths.every(requiredPath => fs.existsSync(requiredPath))) {
            throw new Error(`Forge installer completed without producing all required client artifacts for ${forgeVersion}`)
        }
        logger.info(`[Forge] Client runtime artifacts installed for ${forgeVersion}`)
    }

    async download(onProgress) {
        const assets = [...this.assets]
        if(assets.length === 0) {
            await this.postDownload()
            onProgress(100)
            return
        }

        const expectedTotalSize = assets.reduce((total, asset) => total + (asset.size || 0), 0)
        const receivedByAsset = new Map()
        let receivedTotal = 0
        let nextIndex = 0

        const reportProgress = (asset, progress) => {
            const previous = receivedByAsset.get(asset.id) || 0
            receivedTotal += progress.transferred - previous
            receivedByAsset.set(asset.id, progress.transferred)
            const percent = expectedTotalSize > 0
                ? Math.min(100, Math.trunc((receivedTotal / expectedTotalSize) * 100))
                : 100
            onProgress(percent)
        }

        const worker = async () => {
            while(nextIndex < assets.length) {
                const asset = assets[nextIndex++]
                await downloadAsset(asset, progress => reportProgress(asset, progress))
            }
        }

        const workerCount = Math.min(DOWNLOAD_CONCURRENCY, assets.length)
        await Promise.all(Array.from({ length: workerCount }, () => worker()))
        await this.postDownload()
        onProgress(100)
        logger.info(`[Download] All ${assets.length} file(s) downloaded successfully`)
    }

    async postDownload() {
        for(const processor of this.processors) {
            await processor.postDownload()
        }
    }
}

module.exports = ReliableRepair
module.exports.downloadAsset = downloadAsset
