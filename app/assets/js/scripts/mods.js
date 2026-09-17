/**
 * Nebula Standalone Mod Manager Controller (mods.js)
 * Manages Server Mods, User Option Mods (Modrinth), Drop-in Mods, and Shaderpacks.
 */
const { ipcRenderer, shell } = require('electron')
const path                   = require('path')
const { Type }               = require('helios-distribution-types')
const ConfigManager          = require('./assets/js/configmanager')
const { DistroAPI }          = require('./assets/js/distromanager')
const DropinModUtil          = require('./assets/js/dropinmodutil')
const ModrinthAPI            = require('./assets/js/modrinthapi')
const UserOptionMods         = require('./assets/js/useroptionmods')
const Lang                   = require('./assets/js/langloader')
const { USER_OPTION_MODS_OPCODE } = require('./assets/js/ipcconstants')

let userModsSearchTimer
let userModsSearchRequest = 0
let userModsInstalled = []
let userModsResults = []
let CACHE_MODS_DIR
let CACHE_DROPIN_MODS_LIST
let CACHE_INSTANCE_DIR
let CACHE_SHADERPACKS_LIST
let CACHE_SELECTED_SHADERPACK_NAME

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

// Initialize Tabs
function initModsTabs() {
    const navItems = document.querySelectorAll('.modsNavItem')
    const tabContents = document.querySelectorAll('.modsTabContent')

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-target')
            navItems.forEach(nav => nav.classList.remove('selected'))
            item.classList.add('selected')

            tabContents.forEach(tab => {
                if(tab.id === targetId) {
                    $(tab).fadeIn(200)
                } else {
                    tab.style.display = 'none'
                }
            })
        })
    })
}

// Bind Header Action Buttons
function initModsHeaderActions() {
    const closeBtn = document.getElementById('modsCloseButton')
    if(closeBtn) {
        closeBtn.onclick = () => {
            saveAllModsConfig()
            switchView(getCurrentView(), VIEWS.landing)
        }
    }

    const openFolderBtn = document.getElementById('modsOpenFolderButton')
    if(openFolderBtn) {
        openFolderBtn.onclick = async () => {
            try {
                const distro = await DistroAPI.getDistribution()
                const serv = distro.getServerById(ConfigManager.getSelectedServer())
                const modsDir = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
                DropinModUtil.validateDir(modsDir)
                shell.openPath(modsDir)
            } catch(e) {
                console.error('Failed to open mods directory', e)
            }
        }
    }

    const refreshBtn = document.getElementById('modsRefreshButton')
    if(refreshBtn) {
        refreshBtn.onclick = async () => {
            await prepareMods(true)
        }
    }
}

// Save all mods configuration
function saveAllModsConfig() {
    try {
        saveDropinModConfiguration()
        saveShaderpackSettings()
    } catch(e) {
        console.warn('Error saving mods config', e)
    }
}

// Server Required and Optional Mods
async function resolveServerModsForUI() {
    const serv = ConfigManager.getSelectedServer()
    const distro = await DistroAPI.getDistribution()
    const servConf = ConfigManager.getModConfiguration(serv)
    const serverObj = distro.getServerById(serv)

    if(!serverObj) return

    const modStr = parseModulesForUI(serverObj.modules, false, servConf.mods)
    const reqCont = document.getElementById('settingsReqModsContent')
    const optCont = document.getElementById('settingsOptModsContent')
    if(reqCont) reqCont.innerHTML = modStr.reqMods
    if(optCont) optCont.innerHTML = modStr.optMods
}

function parseModulesForUI(mdls, submodules, servConf) {
    let reqMods = ''
    let optMods = ''

    for(const mdl of mdls) {
        if(mdl.rawModule.type === Type.ForgeMod || mdl.rawModule.type === Type.LiteMod || mdl.rawModule.type === Type.LiteLoader || mdl.rawModule.type === Type.FabricMod) {
            const moduleId = escapeHtml(mdl.getVersionlessMavenIdentifier())
            const moduleName = escapeHtml(mdl.rawModule.name)
            const moduleVersion = escapeHtml(mdl.mavenComponents.version)

            if(mdl.getRequired().value) {
                reqMods += `<div id="${moduleId}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${moduleName}</span>
                                <span class="settingsModVersion">v${moduleVersion}</span>
                            </div>
                        </div>
                        <div class="settingsModLockBadge">🔒 필수</div>
                    </div>
                </div>`
            } else {
                let checked = true
                if(servConf != null && servConf[mdl.getVersionlessMavenIdentifier()] != null) {
                    checked = typeof servConf[mdl.getVersionlessMavenIdentifier()] === 'boolean'
                        ? servConf[mdl.getVersionlessMavenIdentifier()]
                        : servConf[mdl.getVersionlessMavenIdentifier()].value
                }
                optMods += `<div id="${moduleId}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" ${checked ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${moduleName}</span>
                                <span class="settingsModVersion">v${moduleVersion}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${moduleId}" ${checked ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
            }
        }
    }
    return { reqMods, optMods }
}

function bindModsToggleSwitch() {
    const switches = document.querySelectorAll('#modsContainer .settingsBaseMod .toggleSwitch input')
    switches.forEach(sw => {
        sw.onchange = () => {
            const parent = sw.closest('.settingsBaseMod')
            if(parent) {
                if(sw.checked) {
                    parent.setAttribute('enabled', '')
                } else {
                    parent.removeAttribute('enabled')
                }
            }
            saveModConfiguration()
        }
    })
}

function saveModConfiguration() {
    const serv = ConfigManager.getSelectedServer()
    const servConf = ConfigManager.getModConfiguration(serv)
    if(!servConf || !servConf.mods) return

    const switches = document.querySelectorAll('#modsContainer [formod]')
    switches.forEach(sw => {
        const modId = sw.getAttribute('formod')
        if(!sw.hasAttribute('dropin')) {
            if(typeof servConf.mods[modId] === 'boolean') {
                servConf.mods[modId] = sw.checked
            } else if(servConf.mods[modId] != null) {
                servConf.mods[modId].value = sw.checked
            }
        }
    })
    ConfigManager.setModConfiguration(serv, servConf)
    ConfigManager.save()
}

// Drop-in Mods Logic
async function resolveDropinModsForUI() {
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        CACHE_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
        CACHE_DROPIN_MODS_LIST = DropinModUtil.scanForDropinMods(CACHE_MODS_DIR, serv.rawServer.minecraftVersion)

        let dropinMods = ''
        for(const dropin of CACHE_DROPIN_MODS_LIST) {
            dropinMods += `<div id="${escapeHtml(dropin.fullName)}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                <div class="settingsModContent">
                    <div class="settingsModMainWrapper">
                        <div class="settingsModStatus"></div>
                        <div class="settingsModDetails">
                            <span class="settingsModName">${escapeHtml(dropin.name)}</span>
                            <div class="settingsDropinRemoveWrapper">
                                <button class="settingsDropinRemoveButton" remmod="${escapeHtml(dropin.fullName)}">삭제</button>
                            </div>
                        </div>
                    </div>
                    <label class="toggleSwitch">
                        <input type="checkbox" formod="${escapeHtml(dropin.fullName)}" dropin ${!dropin.disabled ? 'checked' : ''}>
                        <span class="toggleSwitchSlider"></span>
                    </label>
                </div>
            </div>`
        }

        const dropinCont = document.getElementById('settingsDropinModsContent')
        if(dropinCont) {
            dropinCont.innerHTML = dropinMods || '<div class="modsEmptyNotice">추가된 외부 모드가 없습니다. 위의 "모드 폴더 열기" 버튼으로 .jar 파일을 넣어보세요.</div>'
        }
    } catch(e) {
        console.error('Error scanning drop-in mods', e)
    }
}

function bindDropinModsRemoveButton() {
    const sEls = document.querySelectorAll('#modsContainer [remmod]')
    sEls.forEach(v => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            const res = await DropinModUtil.deleteDropinMod(CACHE_MODS_DIR, fullName)
            if(res) {
                const el = document.getElementById(fullName)
                if(el) el.remove()
            }
        }
    })
}

function bindDropinModFileSystemButton() {
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    if(fsBtn) {
        fsBtn.onclick = () => {
            DropinModUtil.validateDir(CACHE_MODS_DIR)
            shell.openPath(CACHE_MODS_DIR)
        }
    }
}

function saveDropinModConfiguration() {
    if(!CACHE_DROPIN_MODS_LIST) return
    for(const dropin of CACHE_DROPIN_MODS_LIST) {
        const sw = document.querySelector(`#modsContainer input[formod='${dropin.fullName}']`)
        if(sw) {
            if(!sw.checked && !dropin.disabled) {
                DropinModUtil.disableMod(CACHE_MODS_DIR, dropin.fullName)
            } else if(sw.checked && dropin.disabled) {
                DropinModUtil.enableMod(CACHE_MODS_DIR, dropin.fullName)
            }
        }
    }
}

// Shaderpacks Logic
async function resolveShaderpacksForUI() {
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        CACHE_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
        CACHE_SHADERPACKS_LIST = DropinModUtil.scanForShaderpacks(CACHE_INSTANCE_DIR)
        CACHE_SELECTED_SHADERPACK_NAME = DropinModUtil.getEnabledShaderpack(CACHE_INSTANCE_DIR)

        setShadersOptions(CACHE_SHADERPACKS_LIST, CACHE_SELECTED_SHADERPACK_NAME)
    } catch(e) {
        console.error('Error scanning shaderpacks', e)
    }
}

function setShadersOptions(arr, selected) {
    const cont = document.getElementById('settingsShadersOptions')
    if(!cont) return
    cont.innerHTML = ''
    for(const opt of arr) {
        const d = document.createElement('DIV')
        d.innerHTML = escapeHtml(opt.name)
        d.setAttribute('value', opt.fullName)
        if(opt.fullName === selected) {
            d.setAttribute('selected', '')
            document.getElementById('settingsShadersSelected').innerHTML = escapeHtml(opt.name)
        }
        d.addEventListener('click', function() {
            this.parentNode.previousElementSibling.innerHTML = this.innerHTML
            for(let sib of this.parentNode.children) {
                sib.removeAttribute('selected')
            }
            this.setAttribute('selected', '')
            cont.setAttribute('hidden', '')
            saveShaderpackSettings()
        })
        cont.appendChild(d)
    }

    const selectedDisplay = document.getElementById('settingsShadersSelected')
    if(selectedDisplay) {
        selectedDisplay.onclick = (e) => {
            e.stopPropagation()
            if(cont.hasAttribute('hidden')) {
                cont.removeAttribute('hidden')
            } else {
                cont.setAttribute('hidden', '')
            }
        }
    }
}

function saveShaderpackSettings() {
    if(!CACHE_INSTANCE_DIR) return
    let sel = 'OFF'
    const opts = document.querySelectorAll('#settingsShadersOptions div')
    opts.forEach(opt => {
        if(opt.hasAttribute('selected')) {
            sel = opt.getAttribute('value')
        }
    })
    DropinModUtil.setEnabledShaderpack(CACHE_INSTANCE_DIR, sel)
}

function bindShaderpackButton() {
    const spBtn = document.getElementById('settingsShaderpackButton')
    if(spBtn) {
        spBtn.onclick = () => {
            const p = path.join(CACHE_INSTANCE_DIR, 'shaderpacks')
            DropinModUtil.validateDir(p)
            shell.openPath(p)
        }
    }
}

// Modrinth User Option Mods
function setUserModsError(message = '') {
    const errBox = document.getElementById('settingsUserModsError')
    if(errBox) errBox.textContent = message
}

function userModsButton(label, onClick, className = '') {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    if(className) button.className = className
    button.addEventListener('click', onClick)
    return button
}

function renderUserModCard(project, installed = null) {
    const card = document.createElement('div')
    card.className = 'settingsUserModCard'

    if(project.iconUrl) {
        const icon = document.createElement('img')
        icon.className = 'settingsUserModIcon'
        icon.src = project.iconUrl
        icon.alt = ''
        card.appendChild(icon)
    }

    const info = document.createElement('div')
    info.className = 'settingsUserModInfo'
    const title = document.createElement('span')
    title.className = 'settingsUserModTitle'
    title.textContent = project.title || project.name || project.projectId || project.slug
    info.appendChild(title)

    const desc = document.createElement('span')
    desc.className = 'settingsUserModDesc'
    desc.textContent = project.description || ''
    info.appendChild(desc)

    const meta = document.createElement('div')
    meta.className = 'settingsUserModMeta'
    if(project.downloads != null) {
        const dl = document.createElement('span')
        dl.textContent = `📥 ${project.downloads.toLocaleString()}회`
        meta.appendChild(dl)
    }
    if(project.author) {
        const author = document.createElement('span')
        author.textContent = `👤 ${project.author}`
        meta.appendChild(author)
    }
    if(installed?.versionNumber) {
        const version = document.createElement('span')
        version.textContent = `버전: v${installed.versionNumber}`
        meta.appendChild(version)
    }
    info.appendChild(meta)
    card.appendChild(info)

    const actions = document.createElement('div')
    actions.className = 'settingsUserModActions'

    const detailsButton = userModsButton('상세보기', async () => {
        showUserModDetails(project.projectId || project.slug)
    }, 'nebula-btn-glass')
    actions.appendChild(detailsButton)

    if(installed) {
        const toggleBtn = userModsButton(installed.disabled ? '활성화' : '비활성화', async () => {
            toggleBtn.disabled = true
            await UserOptionMods.setModEnabled(installed.projectId, installed.disabled)
            await loadUserMods()
            await searchUserMods()
        }, installed.disabled ? 'nebula-btn-primary' : 'nebula-btn-glass')
        actions.appendChild(toggleBtn)

        const uninstallBtn = userModsButton('삭제', async () => {
            uninstallBtn.disabled = true
            await UserOptionMods.uninstallMod(installed.projectId)
            await loadUserMods()
            await searchUserMods()
        }, 'nebula-btn-danger')
        actions.appendChild(uninstallBtn)
    } else {
        const installBtn = userModsButton('설치하기', async () => {
            installBtn.disabled = true
            installBtn.textContent = '설치 중...'
            try {
                await installUserMod(project)
                await loadUserMods()
                await searchUserMods()
            } catch(err) {
                setUserModsError(err.message)
                installBtn.disabled = false
                installBtn.textContent = '설치하기'
            }
        }, 'nebula-btn-primary')
        actions.appendChild(installBtn)
    }

    card.appendChild(actions)
    return card
}

async function installUserMod(project) {
    setUserModsError('')
    const projectId = project.projectId || project.slug
    const version = await ModrinthAPI.resolveCompatibleVersion(projectId, UserOptionMods.getActiveGameVersion())
    if(!version) {
        throw new Error('이 모드는 마인크래프트 1.20.1 Forge와 호환되는 릴리즈가 없습니다.')
    }
    await UserOptionMods.installMod(projectId, version)
}

function renderUserModsResults(results) {
    const container = document.getElementById('settingsUserModsResults')
    if(!container) return
    container.innerHTML = ''
    if(results.length === 0) {
        container.innerHTML = '<div class="modsEmptyNotice">검색 조건에 맞는 Modrinth 모드가 없습니다.</div>'
        return
    }
    results.forEach(project => {
        const installed = userModsInstalled.find(item => item.projectId === (project.projectId || project.slug))
        container.appendChild(renderUserModCard(project, installed))
    })
}

function renderUserModsInstalled() {
    const container = document.getElementById('settingsUserModsInstalled')
    if(!container) return
    container.innerHTML = ''
    if(userModsInstalled.length === 0) {
        container.innerHTML = '<div class="modsEmptyNotice">설치된 개인 모드가 없습니다. 위의 Modrinth 검색창에서 원하는 모드를 찾아 설치해 보세요!</div>'
        return
    }
    userModsInstalled.forEach(project => {
        container.appendChild(renderUserModCard(project, project))
    })
}

async function loadUserMods() {
    userModsInstalled = await UserOptionMods.getInstalledMods()
    renderUserModsInstalled()
}

async function searchUserMods() {
    const requestId = ++userModsSearchRequest
    setUserModsError('')
    try {
        const query = document.getElementById('settingsUserModsSearch')?.value || ''
        const category = document.getElementById('settingsUserModsCategory')?.value || 'all'
        const sort = document.getElementById('settingsUserModsSort')?.value || 'relevance'

        const results = await ModrinthAPI.searchMods({
            query,
            category,
            sort,
            limit: 20,
            gameVersion: UserOptionMods.getActiveGameVersion()
        })
        if(requestId !== userModsSearchRequest) return
        userModsResults = results
        renderUserModsResults(results)
    } catch(err) {
        if(requestId !== userModsSearchRequest) return
        setUserModsError('Modrinth 모드 검색 실패: ' + err.message)
    }
}

function scheduleUserModsSearch() {
    clearTimeout(userModsSearchTimer)
    userModsSearchTimer = setTimeout(() => {
        searchUserMods()
    }, 350)
}

async function showUserModDetails(projectId) {
    const detailsContainer = document.getElementById('settingsUserModsDetails')
    if(!detailsContainer) return
    detailsContainer.hidden = false
    detailsContainer.innerHTML = '<div class="modsDetailsLoading">모드 상세정보 불러오는 중...</div>'
    try {
        const project = await ModrinthAPI.getProject(projectId)
        const version = await ModrinthAPI.resolveCompatibleVersion(projectId, UserOptionMods.getActiveGameVersion())

        detailsContainer.innerHTML = `
            <div class="settingsUserModsDetailsCard">
                <div class="settingsUserModsDetailsHeader">
                    ${project.iconUrl ? `<img src="${project.iconUrl}" alt="" class="settingsUserModIcon">` : ''}
                    <div>
                        <h3>${escapeHtml(project.title || project.slug)}</h3>
                        <p>${escapeHtml(project.description || '')}</p>
                    </div>
                    <button type="button" class="settingsUserModsDetailsClose nebula-btn-glass">✕ 닫기</button>
                </div>
                <div class="settingsUserModsDetailsMeta">
                    <span>다운로드: ${project.downloads?.toLocaleString() ?? 0}회</span>
                    <span>팔로워: ${project.followers?.toLocaleString() ?? 0}명</span>
                    <span>호환 버전: ${version ? 'v' + version.versionNumber : '호환 버전 없음'}</span>
                </div>
                <div class="settingsUserModsDetailsBody">${project.body ? project.body.slice(0, 800) + '...' : ''}</div>
            </div>
        `
        detailsContainer.querySelector('.settingsUserModsDetailsClose').addEventListener('click', () => {
            detailsContainer.hidden = true
            detailsContainer.innerHTML = ''
        })
    } catch(err) {
        detailsContainer.innerHTML = `<div class="settingsUserModsDetailsCard"><p>모드 상세정보 로드 실패: ${escapeHtml(err.message)}</p><button type="button" class="settingsUserModsDetailsClose nebula-btn-glass">닫기</button></div>`
        detailsContainer.querySelector('.settingsUserModsDetailsClose').addEventListener('click', () => {
            detailsContainer.hidden = true
        })
    }
}

function bindUserModsBrowser() {
    const searchInput = document.getElementById('settingsUserModsSearch')
    const catSelect = document.getElementById('settingsUserModsCategory')
    const sortSelect = document.getElementById('settingsUserModsSort')
    const chkUpdatesBtn = document.getElementById('settingsUserModsCheckUpdates')
    const updAllBtn = document.getElementById('settingsUserModsUpdateAll')

    if(searchInput) searchInput.addEventListener('input', scheduleUserModsSearch)
    if(catSelect) catSelect.addEventListener('change', scheduleUserModsSearch)
    if(sortSelect) sortSelect.addEventListener('change', scheduleUserModsSearch)
    if(chkUpdatesBtn) chkUpdatesBtn.addEventListener('click', checkUserModUpdates)
    if(updAllBtn) updAllBtn.addEventListener('click', updateAllUserMods)
}

async function checkUserModUpdates() {
    setUserModsError('모드 업데이트 확인 중...')
    try {
        const updates = await UserOptionMods.checkForUpdates()
        if(!updates.length) {
            setUserModsError('모든 개인 모드가 최신 버전입니다.')
            return
        }
        setUserModsError(`${updates.length}개의 모드에 새로운 업데이트가 있습니다!`)
    } catch(err) {
        setUserModsError('업데이트 확인 실패: ' + err.message)
    }
}

async function updateAllUserMods() {
    setUserModsError('모든 모드 업데이트 적용 중...')
    try {
        const count = await UserOptionMods.updateAll()
        setUserModsError(`${count}개 모드가 최신 버전으로 업데이트되었습니다.`)
        await loadUserMods()
    } catch(err) {
        setUserModsError('일괄 업데이트 실패: ' + err.message)
    }
}

// Master prepareMods function
async function prepareMods(forceRefresh = false) {
    try {
        const distro = await DistroAPI.getDistribution()
        const selectedServer = distro.getServerById(ConfigManager.getSelectedServer())
        if(selectedServer) {
            UserOptionMods.setActiveGameVersion(selectedServer.rawServer.minecraftVersion)
            await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.SET_VERSION, selectedServer.rawServer.minecraftVersion)
        }

        await resolveServerModsForUI()
        await resolveDropinModsForUI()
        await resolveShaderpacksForUI()
        await loadUserMods()
        if(forceRefresh || userModsResults.length === 0) {
            await searchUserMods()
        }
        bindDropinModsRemoveButton()
        bindDropinModFileSystemButton()
        bindShaderpackButton()
        bindModsToggleSwitch()
    } catch(e) {
        console.error('Failed to prepare mods UI', e)
    }
}

window.prepareMods = prepareMods
window.saveAllModsConfig = saveAllModsConfig

// Bindings on document ready
document.addEventListener('DOMContentLoaded', () => {
    initModsTabs()
    initModsHeaderActions()
    bindUserModsBrowser()
})
