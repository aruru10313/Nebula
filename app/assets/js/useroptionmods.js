const fs = require('fs-extra')
const path = require('path')

const MANIFEST_VERSION = 1
const GAME_VERSION = '1.20.1'
const LOADER = 'forge'
const DIRECTORY_NAME = 'user-option-mods'

function getRoot(launcherDirectory) {
    return path.join(launcherDirectory, DIRECTORY_NAME)
}

function getModsDirectory(launcherDirectory) {
    return path.join(getRoot(launcherDirectory), 'mods')
}

function getManifestPath(launcherDirectory) {
    return path.join(getRoot(launcherDirectory), 'manifest.json')
}

function emptyManifest() {
    return {
        version: MANIFEST_VERSION,
        gameVersion: GAME_VERSION,
        loader: LOADER,
        mods: []
    }
}

async function readManifest(launcherDirectory) {
    const manifestPath = getManifestPath(launcherDirectory)
    if(!(await fs.pathExists(manifestPath))) {
        return emptyManifest()
    }

    const manifest = await fs.readJson(manifestPath)
    if(manifest.version !== MANIFEST_VERSION || manifest.gameVersion !== GAME_VERSION || manifest.loader !== LOADER || !Array.isArray(manifest.mods)) {
        throw new Error('The personal mod manifest is invalid or uses an unsupported format.')
    }
    manifest.mods.forEach(mod => validateFileName(mod.fileName))
    return manifest
}

async function writeManifest(launcherDirectory, manifest) {
    await fs.ensureDir(getModsDirectory(launcherDirectory))
    await fs.writeJson(getManifestPath(launcherDirectory), manifest, { spaces: 2 })
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

function getEnabledModPaths(launcherDirectory) {
    const manifestPath = getManifestPath(launcherDirectory)
    if(!fs.existsSync(manifestPath)) {
        return []
    }

    const manifest = fs.readJsonSync(manifestPath)
    if(manifest.version !== MANIFEST_VERSION || manifest.gameVersion !== GAME_VERSION || manifest.loader !== LOADER || !Array.isArray(manifest.mods)) {
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
        .map(mod => path.join(getModsDirectory(launcherDirectory), mod.fileName))
        .filter(filePath => fs.existsSync(filePath))
}

exports.GAME_VERSION = GAME_VERSION
exports.LOADER = LOADER
exports.getRoot = getRoot
exports.getModsDirectory = getModsDirectory
exports.getManifestPath = getManifestPath
exports.readManifest = readManifest
exports.writeManifest = writeManifest
exports.getEnabledModPaths = getEnabledModPaths
exports.validateProjectId = validateProjectId
exports.validateFileName = validateFileName
