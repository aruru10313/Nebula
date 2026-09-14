const fs = require('fs-extra')
const path = require('path')

const ConfigManager = require('./configmanager')
const UserOptionMods = require('./useroptionmods')
const { DistroAPI } = require('./distromanager')

const COMMON_MANAGED_DIRECTORIES = ['libraries', 'modstore', 'mods', 'versions']

function absolute(filePath) {
    return path.resolve(filePath)
}

function isWithin(filePath, directory, includeDirectory = false) {
    const relative = path.relative(absolute(directory), absolute(filePath))
    return (includeDirectory && relative === '') || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isExcluded(filePath, excludedPaths) {
    return excludedPaths.some(excludedPath => isWithin(filePath, excludedPath, true))
}

function addUniquePath(paths, filePath) {
    const normalized = absolute(filePath)
    if(!paths.some(existing => existing === normalized)) {
        paths.push(normalized)
    }
}

function getModulePaths(server) {
    const modulePaths = []

    function visit(modules) {
        if(!Array.isArray(modules)) {
            return
        }
        for(const module of modules) {
            if(typeof module?.getPath === 'function') {
                addUniquePath(modulePaths, module.getPath())
            }
            visit(module?.subModules)
        }
    }

    visit(server.modules)
    return modulePaths
}

function getDefaultRoots(commonDirectory, instanceDirectory, modulePaths) {
    const roots = []

    for(const directory of COMMON_MANAGED_DIRECTORIES) {
        addUniquePath(roots, path.join(commonDirectory, directory))
    }

    const instanceModsDirectory = path.join(instanceDirectory, 'mods')
    if(modulePaths.some(modulePath => isWithin(modulePath, instanceModsDirectory, true))) {
        addUniquePath(roots, instanceModsDirectory)
    }

    return roots
}

async function scanDirectory(directory, excludedPaths, candidates, root) {
    if(!(await fs.pathExists(directory))) {
        return
    }

    const stats = await fs.lstat(directory)
    if(!stats.isDirectory()) {
        return
    }

    const entries = await fs.readdir(directory, { withFileTypes: true })
    for(const entry of entries) {
        const filePath = path.join(directory, entry.name)
        if(isExcluded(filePath, excludedPaths)) {
            continue
        }

        if(entry.isDirectory()) {
            await scanDirectory(filePath, excludedPaths, candidates, root)
            continue
        }

        if(!entry.isFile()) {
            continue
        }

        const stats = await fs.stat(filePath)
        candidates.push({
            path: absolute(filePath),
            relativePath: path.relative(root, filePath),
            root: absolute(root),
            size: stats.size
        })
    }
}

function resolveDistributionServer(distribution, serverId) {
    if(distribution == null || typeof distribution.getServerById !== 'function') {
        throw new Error('The distribution API returned an invalid distribution.')
    }

    const server = distribution.getServerById(serverId)
    if(server == null) {
        throw new Error(`The selected distribution server "${serverId}" does not exist.`)
    }
    return server
}

function resolveConfirmation(confirmation) {
    return confirmation === true || confirmation?.confirmed === true
}

function validateScanResult(scanResult) {
    if(scanResult == null || !Array.isArray(scanResult.candidates) || !Array.isArray(scanResult.roots) || !Array.isArray(scanResult.excludedPaths) || !Array.isArray(scanResult.protectedPaths)) {
        throw new TypeError('An unmodified scan result is required.')
    }
}

function validateCandidate(candidate, scanResult) {
    if(candidate == null || typeof candidate.path !== 'string') {
        return 'invalid candidate'
    }

    const candidatePath = absolute(candidate.path)
    if(!scanResult.roots.some(root => isWithin(candidatePath, root))) {
        return 'outside scan roots'
    }
    if(isExcluded(candidatePath, scanResult.excludedPaths)) {
        return 'protected option-mod path'
    }
    if(scanResult.protectedPaths.includes(candidatePath)) {
        return 'referenced distribution artifact'
    }
    return null
}

/**
 * Scan the distribution-managed portion of the launcher data directory.
 *
 * The scanner deliberately does not inspect arbitrary instance data such as
 * saves, logs, configs, or screenshots. Option mods are excluded explicitly
 * even when a caller supplies a broad custom scan root.
 *
 * @param {object} options
 * @param {object} options.distribution An optional already-loaded Helios distribution.
 * @param {string} options.serverId The server to compare against.
 * @param {string[]} options.scanRoots Optional roots for tests or later integrations.
 * @returns {Promise<object>} Candidate files and their aggregate size.
 */
async function scanUnreferencedFiles(options = {}) {
    const launcherDirectory = absolute(options.launcherDirectory || ConfigManager.getLauncherDirectory())
    const commonDirectory = absolute(options.commonDirectory || ConfigManager.getCommonDirectory())
    const instanceDirectory = absolute(options.instanceDirectory || ConfigManager.getInstanceDirectory())
    const serverId = options.serverId || ConfigManager.getSelectedServer()

    if(typeof serverId !== 'string' || serverId.length === 0) {
        throw new Error('There is no selected distribution server to scan.')
    }

    DistroAPI.commonDir = commonDirectory
    DistroAPI.instanceDir = instanceDirectory
    const distribution = options.distribution || await DistroAPI.getDistribution()
    const server = resolveDistributionServer(distribution, serverId)
    const modulePaths = getModulePaths(server)
    const protectedPaths = modulePaths.slice()
    const optionModsRoot = absolute(UserOptionMods.getRoot(launcherDirectory))
    const optionModsManifest = absolute(UserOptionMods.getManifestPath(launcherDirectory))
    const localDistributionManifest = absolute(path.join(launcherDirectory, 'distribution.json'))
    const localDevelopmentManifest = absolute(path.join(launcherDirectory, 'distribution_dev.json'))
    const excludedPaths = [
        optionModsRoot,
        optionModsManifest,
        localDistributionManifest,
        localDevelopmentManifest
    ]
    const roots = Array.isArray(options.scanRoots)
        ? options.scanRoots.map(absolute)
        : getDefaultRoots(commonDirectory, path.join(instanceDirectory, server.rawServer.id), modulePaths)
    const uniqueRoots = []

    for(const root of roots) {
        addUniquePath(uniqueRoots, root)
    }

    const candidates = []
    for(const root of uniqueRoots) {
        if(isExcluded(root, excludedPaths)) {
            continue
        }
        await scanDirectory(root, excludedPaths, candidates, root)
    }

    const filteredCandidates = candidates
        .filter(candidate => !protectedPaths.includes(candidate.path))
        .filter((candidate, index, allCandidates) => allCandidates.findIndex(other => other.path === candidate.path) === index)
    const totalBytes = filteredCandidates.reduce((total, candidate) => total + candidate.size, 0)

    return {
        serverId,
        distributionVersion: distribution.rawDistribution?.version || server.rawServer.version,
        roots: uniqueRoots,
        excludedPaths,
        protectedPaths,
        candidates: filteredCandidates,
        candidateCount: filteredCandidates.length,
        totalBytes,
        scannedAt: new Date().toISOString()
    }
}

/**
 * Delete files from a previous scan after explicit caller confirmation.
 *
 * Only regular files from the supplied scan result are unlinked. Required
 * and otherwise referenced distribution artifacts are rechecked before every
 * deletion and can never be removed through this API.
 *
 * @param {object} scanResult A result returned by scanUnreferencedFiles.
 * @param {boolean|object} confirmation `true` or `{ confirmed: true }`.
 * @returns {Promise<object>} Deletion results and any skipped/error entries.
 */
async function deleteUnreferencedFiles(scanResult, confirmation) {
    validateScanResult(scanResult)
    if(!resolveConfirmation(confirmation)) {
        throw new Error('Deleting unreferenced files requires explicit confirmation.')
    }

    const deleted = []
    const skipped = []
    const errors = []

    for(const candidate of scanResult.candidates) {
        const reason = validateCandidate(candidate, scanResult)
        if(reason != null) {
            skipped.push({ path: candidate?.path, reason })
            continue
        }

        const candidatePath = absolute(candidate.path)
        let stats
        try {
            stats = await fs.lstat(candidatePath)
        } catch(error) {
            if(error.code === 'ENOENT') {
                skipped.push({ path: candidatePath, reason: 'file no longer exists' })
                continue
            }
            errors.push({ path: candidatePath, error: error.message, code: error.code })
            continue
        }

        if(!stats.isFile()) {
            skipped.push({ path: candidatePath, reason: 'file is no longer a regular file' })
            continue
        }

        try {
            await fs.unlink(candidatePath)
            deleted.push({ path: candidatePath, size: stats.size })
        } catch(error) {
            errors.push({ path: candidatePath, error: error.message, code: error.code })
        }
    }

    return {
        deleted,
        deletedCount: deleted.length,
        deletedBytes: deleted.reduce((total, candidate) => total + candidate.size, 0),
        skipped,
        errors
    }
}

exports.scanUnreferencedFiles = scanUnreferencedFiles
exports.deleteUnreferencedFiles = deleteUnreferencedFiles
exports.scan = scanUnreferencedFiles
exports.deleteCandidates = deleteUnreferencedFiles
