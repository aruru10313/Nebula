const fs = require('fs-extra')
const got = require('got')
const path = require('path')

const UserOptionMods = require('./useroptionmods')

const API_URL = 'https://api.modrinth.com/v2'
const CACHE_TTL = 5 * 60 * 1000
const searchCache = new Map()
const SORTS = new Set(['relevance', 'downloads', 'follows', 'newest', 'updated'])

function json(value) {
    return JSON.stringify(value)
}

function validateSort(sort) {
    return SORTS.has(sort) ? sort : 'relevance'
}

function validateCategory(category) {
    if(category == null || category === '' || category === 'all') {
        return null
    }
    if(typeof category !== 'string' || !/^[a-z0-9-]+$/.test(category)) {
        throw new Error('Invalid Modrinth category.')
    }
    return category
}

async function search({ query = '', category = 'all', sort = 'relevance' } = {}) {
    const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 100) : ''
    const normalizedCategory = validateCategory(category)
    const normalizedSort = validateSort(sort)
    const cacheKey = JSON.stringify([normalizedQuery, normalizedCategory, normalizedSort])
    const cached = searchCache.get(cacheKey)
    if(cached != null && cached.expiresAt > Date.now()) {
        return cached.value
    }

    const facets = [
        ['project_type:mod'],
        [`versions:${UserOptionMods.GAME_VERSION}`],
        ['client_side:required'],
        ['server_side:optional'],
        [`loaders:${UserOptionMods.LOADER}`]
    ]
    if(normalizedCategory != null) {
        facets.push([`categories:${normalizedCategory}`])
    }

    const response = await got(`${API_URL}/search`, {
        searchParams: {
            query: normalizedQuery,
            facets: json(facets),
            index: normalizedSort,
            limit: '40'
        },
        responseType: 'json',
        timeout: { request: 15000 }
    })
    const value = {
        hits: response.body.hits.map(project => ({
            projectId: project.project_id,
            slug: project.slug,
            title: project.title,
            description: project.description,
            iconUrl: project.icon_url,
            downloads: project.downloads,
            follows: project.follows,
            categories: project.categories,
            dateModified: project.date_modified
        })),
        totalHits: response.body.total_hits
    }
    searchCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL })
    return value
}

async function getDetails(projectId) {
    UserOptionMods.validateProjectId(projectId)
    const [projectResponse, versionsResponse] = await Promise.all([
        got(`${API_URL}/project/${encodeURIComponent(projectId)}`, {
            responseType: 'json',
            timeout: { request: 15000 }
        }),
        getCompatibleVersions(projectId)
    ])
    return {
        project: projectResponse.body,
        versions: versionsResponse
    }
}

async function getCompatibleVersions(projectId) {
    UserOptionMods.validateProjectId(projectId)
    const response = await got(`${API_URL}/project/${encodeURIComponent(projectId)}/version`, {
        searchParams: {
            game_versions: json([UserOptionMods.GAME_VERSION]),
            loaders: json([UserOptionMods.LOADER])
        },
        responseType: 'json',
        timeout: { request: 15000 }
    })
    return response.body
}

function validateDownloadUrl(url) {
    const parsed = new URL(url)
    if(parsed.protocol !== 'https:' || !['cdn.modrinth.com', 'modrinth.com'].includes(parsed.hostname)) {
        throw new Error('Modrinth returned an unsafe download URL.')
    }
}

function safeFileName(fileName) {
    const normalized = path.basename(fileName)
    if(normalized !== fileName || !/^[a-zA-Z0-9._-]+\.jar$/.test(normalized)) {
        throw new Error('Modrinth returned an invalid mod file name.')
    }
    return normalized
}

async function install(launcherDirectory, { projectId, versionId } = {}) {
    UserOptionMods.validateProjectId(projectId)
    if(typeof versionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(versionId)) {
        throw new Error('Invalid Modrinth version ID.')
    }

    const versions = await getCompatibleVersions(projectId)
    const version = versions.find(candidate => candidate.id === versionId) || versions[0]
    if(version == null || !Array.isArray(version.files) || version.files.length === 0) {
        throw new Error('No Forge 1.20.1 version is available for this Modrinth project.')
    }
    const file = version.files.find(candidate => candidate.primary) || version.files[0]
    validateDownloadUrl(file.url)
    const fileName = safeFileName(file.filename)
    const manifest = await UserOptionMods.readManifest(launcherDirectory)
    const oldMod = manifest.mods.find(mod => mod.projectId === projectId)
    const modsDirectory = UserOptionMods.getModsDirectory(launcherDirectory)
    const targetPath = path.join(modsDirectory, fileName)
    const partialPath = `${targetPath}.download`

    await fs.ensureDir(modsDirectory)
    const downloaded = await got(file.url, {
        responseType: 'buffer',
        timeout: { request: 60000 }
    })
    await fs.writeFile(partialPath, downloaded.body)
    await fs.move(partialPath, targetPath, { overwrite: true })
    if(oldMod != null && oldMod.fileName !== fileName) {
        await fs.remove(path.join(modsDirectory, oldMod.fileName))
    }

    const project = await got(`${API_URL}/project/${encodeURIComponent(projectId)}`, {
        responseType: 'json',
        timeout: { request: 15000 }
    })
    const nextMod = {
        projectId,
        slug: project.body.slug,
        title: project.body.title,
        description: project.body.description,
        iconUrl: project.body.icon_url,
        versionId: version.id,
        versionNumber: version.version_number,
        fileName,
        enabled: oldMod?.enabled !== false,
        installedAt: new Date().toISOString()
    }
    manifest.mods = manifest.mods.filter(mod => mod.projectId !== projectId)
    manifest.mods.push(nextMod)
    await UserOptionMods.writeManifest(launcherDirectory, manifest)
    return nextMod
}

async function listInstalled(launcherDirectory) {
    const manifest = await UserOptionMods.readManifest(launcherDirectory)
    const existing = []
    for(const mod of manifest.mods) {
        const filePath = path.join(UserOptionMods.getModsDirectory(launcherDirectory), mod.fileName)
        if(await fs.pathExists(filePath)) {
            existing.push(mod)
        }
    }
    if(existing.length !== manifest.mods.length) {
        manifest.mods = existing
        await UserOptionMods.writeManifest(launcherDirectory, manifest)
    }
    return existing
}

async function setEnabled(launcherDirectory, projectId, enabled) {
    UserOptionMods.validateProjectId(projectId)
    if(typeof enabled !== 'boolean') {
        throw new Error('Mod enabled state must be a boolean.')
    }
    const manifest = await UserOptionMods.readManifest(launcherDirectory)
    const mod = manifest.mods.find(candidate => candidate.projectId === projectId)
    if(mod == null) {
        throw new Error('That personal mod is not installed.')
    }
    mod.enabled = enabled
    await UserOptionMods.writeManifest(launcherDirectory, manifest)
    return mod
}

async function remove(launcherDirectory, projectId) {
    UserOptionMods.validateProjectId(projectId)
    const manifest = await UserOptionMods.readManifest(launcherDirectory)
    const mod = manifest.mods.find(candidate => candidate.projectId === projectId)
    if(mod == null) {
        throw new Error('That personal mod is not installed.')
    }

    await fs.remove(path.join(UserOptionMods.getModsDirectory(launcherDirectory), mod.fileName))
    manifest.mods = manifest.mods.filter(candidate => candidate.projectId !== projectId)
    await UserOptionMods.writeManifest(launcherDirectory, manifest)
    return { projectId }
}

async function checkUpdates(launcherDirectory) {
    const installed = await listInstalled(launcherDirectory)
    const updates = []
    for(const mod of installed) {
        const versions = await getCompatibleVersions(mod.projectId)
        const latest = versions[0]
        if(latest != null && latest.id !== mod.versionId) {
            updates.push({ ...mod, latestVersionId: latest.id, latestVersionNumber: latest.version_number })
        }
    }
    return updates
}

async function update(launcherDirectory, projectId) {
    const updates = await checkUpdates(launcherDirectory)
    const target = updates.find(mod => mod.projectId === projectId)
    if(target == null) {
        throw new Error('No update is available for that personal mod.')
    }
    return install(launcherDirectory, { projectId, versionId: target.latestVersionId })
}

async function updateAll(launcherDirectory) {
    const updates = await checkUpdates(launcherDirectory)
    const results = []
    for(const mod of updates) {
        results.push(await install(launcherDirectory, { projectId: mod.projectId, versionId: mod.latestVersionId }))
    }
    return results
}

exports.search = search
exports.getDetails = getDetails
exports.install = install
exports.listInstalled = listInstalled
exports.setEnabled = setEnabled
exports.remove = remove
exports.checkUpdates = checkUpdates
exports.update = update
exports.updateAll = updateAll
