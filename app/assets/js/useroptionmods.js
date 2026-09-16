const fs = require('fs-extra')
const path = require('path')

const MANIFEST_VERSION = 1
const DEFAULT_GAME_VERSION = '1.20.1'
const LOADER = 'forge'
const DIRECTORY_NAME = 'user-option-mods'
let activeGameVersion = DEFAULT_GAME_VERSION

function normalizeGameVersion(gameVersion) {
    if(typeof gameVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(gameVersion)) {
        throw new Error('Invalid Minecraft version.')
    }
    return gameVersion
}

function getGameVersion(gameVersion) {
    return normalizeGameVersion(gameVersion || activeGameVersion)
}

function setActiveGameVersion(gameVersion) {
    activeGameVersion = normalizeGameVersion(gameVersion)
}

function getRoot(launcherDirectory, gameVersion) {
    return path.join(launcherDirectory, DIRECTORY_NAME, getGameVersion(gameVersion), LOADER)
}

function getModsDirectory(launcherDirectory, gameVersion) {
    return path.join(getRoot(launcherDirectory, gameVersion), 'mods')
}

function getManifestPath(launcherDirectory, gameVersion) {
    return path.join(getRoot(launcherDirectory, gameVersion), 'manifest.json')
}

function emptyManifest() {
    return {
        version: MANIFEST_VERSION,
        gameVersion: getGameVersion(),
        loader: LOADER,
        mods: []
    }
}

async function readManifest(launcherDirectory, gameVersion) {
    const selectedGameVersion = getGameVersion(gameVersion)
    const manifestPath = getManifestPath(launcherDirectory, selectedGameVersion)
    if(!(await fs.pathExists(manifestPath))) {
        return emptyManifest()
    }

    const manifest = await fs.readJson(manifestPath)
    if(manifest.version !== MANIFEST_VERSION || manifest.gameVersion !== selectedGameVersion || manifest.loader !== LOADER || !Array.isArray(manifest.mods)) {
        throw new Error('The personal mod manifest is invalid or uses an unsupported format.')
    }
    manifest.mods.forEach(mod => validateFileName(mod.fileName))
    return manifest
}

async function writeManifest(launcherDirectory, manifest, gameVersion) {
    const selectedGameVersion = getGameVersion(gameVersion || manifest.gameVersion)
    if(manifest.gameVersion !== selectedGameVersion) {
        throw new Error('The personal mod manifest version does not match the selected Minecraft version.')
    }
    await fs.ensureDir(getModsDirectory(launcherDirectory, selectedGameVersion))
    await fs.writeJson(getManifestPath(launcherDirectory, selectedGameVersion), manifest, { spaces: 2 })
}

function validateProjectId(projectId) {
    if(typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
        throw new Error('Invalid Modrinth project ID.')
    }
}

function validateFileName(fileName) {
    if(typeof fileName !== 'string' || path.basename(fileName) !== fileName || !/^[a-zA-Z0-9._-]+\.jar$/.test(fileName)) {
        throw new Error('The personal mod manifest contains an invalid file name.')
    }
}

function getEnabledModPaths(launcherDirectory, gameVersion) {
    const selectedGameVersion = getGameVersion(gameVersion)
    const manifestPath = getManifestPath(launcherDirectory, selectedGameVersion)
    if(!fs.existsSync(manifestPath)) {
        return []
    }

    const manifest = fs.readJsonSync(manifestPath)
    if(manifest.version !== MANIFEST_VERSION || manifest.gameVersion !== selectedGameVersion || manifest.loader !== LOADER || !Array.isArray(manifest.mods)) {
        throw new Error('The personal mod manifest is invalid or uses an unsupported format.')
    }

    return manifest.mods
        .filter(mod => {
            if(typeof mod.fileName !== 'string') {
                return false
            }
            validateFileName(mod.fileName)
            return mod.enabled !== false
        })
        .map(mod => path.join(getModsDirectory(launcherDirectory, selectedGameVersion), mod.fileName))
        .filter(filePath => fs.existsSync(filePath))
}

exports.DEFAULT_GAME_VERSION = DEFAULT_GAME_VERSION
exports.setActiveGameVersion = setActiveGameVersion
Object.defineProperty(exports, 'GAME_VERSION', { enumerable: true, get: () => activeGameVersion })
exports.LOADER = LOADER
exports.getRoot = getRoot
exports.getModsDirectory = getModsDirectory
exports.getManifestPath = getManifestPath
exports.readManifest = readManifest
exports.writeManifest = writeManifest
exports.getEnabledModPaths = getEnabledModPaths
exports.validateProjectId = validateProjectId
exports.validateFileName = validateFileName
