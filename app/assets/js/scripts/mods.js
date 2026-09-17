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
const Lang                   = require('./assets/js/langloader')
const { USER_OPTION_MODS_OPCODE } = require('./assets/js/ipcconstants')

let userModsSearchTimer = null
let userModsSearchRequest = 0
let userModsInstalled = []
let userModsResults = []
let CACHE_MODS_DIR = null
let CACHE_DROPIN_MODS_LIST = []
let CACHE_INSTANCE_DIR = null
let CACHE_SHADERPACKS_LIST = []
let CACHE_SELECTED_SHADERPACK_NAME = 'OFF'

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

/**
 * Return to main landing view safely, saving current state.
 */
function closeModsView() {
    try {
        saveAllModsConfig()
    } catch(e) {
        console.warn('Error saving mods config on close:', e)
    }
    const current = (typeof getCurrentView === 'function' && getCurrentView()) || VIEWS.mods
    if(typeof switchView === 'function') {
        switchView(current, VIEWS.landing)
    } else {
        $(VIEWS.mods).fadeOut(300, () => {
            $(VIEWS.landing).fadeIn(300)
        })
    }
}

/**
 * Save all mod configuration (server toggles, drop-in, shaderpacks).
 */
function saveAllModsConfig() {
    try {
        saveModConfiguration()
        saveDropinModConfiguration()
        saveShaderpackSettings()
        ConfigManager.save()
    } catch(e) {
        console.warn('Error during saveAllModsConfig:', e)
    }
}

/**
 * Tab Navigation Handling
 */
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
                    $(tab).fadeIn(180)
                } else {
                    tab.style.display = 'none'
                }
            })
        })
    })
}

/**
 * Bind Navigation and Action Buttons
 */
function initModsActions() {
    // Back & Close Buttons
    const backBtn = document.getElementById('modsBackButton')
    if(backBtn) backBtn.onclick = closeModsView

    const closeBtn = document.getElementById('modsCloseButton')
    if(closeBtn) closeBtn.onclick = closeModsView

    const footerDoneBtn = document.getElementById('modsFooterDoneButton')
    if(footerDoneBtn) footerDoneBtn.onclick = closeModsView

    // Folder Open Button
    const openFolderBtn = document.getElementById('modsOpenFolderButton')
    if(openFolderBtn) {
        openFolderBtn.onclick = async () => {
            try {
                if(CACHE_MODS_DIR) {
                    DropinModUtil.validateDir(CACHE_MODS_DIR)
                    shell.openPath(CACHE_MODS_DIR)
                } else {
                    const distro = await DistroAPI.getDistribution()
                    const serv = distro.getServerById(ConfigManager.getSelectedServer())
                    const modsDir = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
                    DropinModUtil.validateDir(modsDir)
                    shell.openPath(modsDir)
                }
            } catch(e) {
                console.error('Failed to open mods directory:', e)
            }
        }
    }

    // Refresh Button
    const refreshBtn = document.getElementById('modsRefreshButton')
    if(refreshBtn) {
        refreshBtn.onclick = async () => {
            await prepareMods(true)
        }
    }

    // Global Keyboard Listeners (Escape to close, F5 to refresh)
    document.addEventListener('keydown', (e) => {
        const current = typeof getCurrentView === 'function' ? getCurrentView() : null
        if(current === VIEWS.mods) {
            if(e.key === 'Escape') {
                const details = document.getElementById('settingsUserModsDetails')
                if(details && !details.hidden) {
                    details.hidden = true
                    details.innerHTML = ''
                    return
                }
                closeModsView()
            } else if(e.key === 'F5') {
                e.preventDefault()
                prepareMods(true)
            }
        }
    })
}

/* ==========================================================================
   Tab 1: Modrinth User Option Mods
   ========================================================================== */

function setUserModsError(message = '') {
    const errBox = document.getElementById('settingsUserModsError')
    if(errBox) {
        errBox.textContent = message
        errBox.style.display = message ? 'block' : 'none'
    }
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
    if(installed) card.classList.add('is-installed')

    const header = document.createElement('div')
    header.className = 'settingsUserModCardTop'

    if(project.iconUrl) {
        const icon = document.createElement('img')
        icon.className = 'settingsUserModIcon'
        icon.src = project.iconUrl
        icon.alt = ''
        header.appendChild(icon)
    } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'settingsUserModIconPlaceholder'
        placeholder.textContent = (project.title || project.slug || 'M').slice(0, 1).toUpperCase()
        header.appendChild(placeholder)
    }

    const titleGroup = document.createElement('div')
    titleGroup.className = 'settingsUserModTitleGroup'

    const title = document.createElement('div')
    title.className = 'settingsUserModTitle'
    title.textContent = project.title || project.name || project.slug || project.projectId

    const author = document.createElement('div')
    author.className = 'settingsUserModAuthor'
    author.textContent = project.author ? `by ${project.author}` : ''

    titleGroup.appendChild(title)
    if(project.author) titleGroup.appendChild(author)
    header.appendChild(titleGroup)

    if(installed) {
        const badge = document.createElement('span')
        badge.className = `modsInstalledBadge ${installed.enabled !== false ? 'badge-enabled' : 'badge-disabled'}`
        badge.textContent = installed.enabled !== false ? '● 사용 중' : '○ 비활성화'
        header.appendChild(badge)
    }

    card.appendChild(header)

    const desc = document.createElement('p')
    desc.className = 'settingsUserModDesc'
    desc.textContent = project.description || '모드 설명이 없습니다.'
    card.appendChild(desc)

    const meta = document.createElement('div')
    meta.className = 'settingsUserModMeta'
    if(project.downloads != null) {
        const dl = document.createElement('span')
        dl.textContent = `📥 ${Number(project.downloads).toLocaleString()}회 다운로드`
        meta.appendChild(dl)
    }
    if(installed && installed.versionNumber) {
        const ver = document.createElement('span')
        ver.textContent = `🏷️ v${installed.versionNumber}`
        meta.appendChild(ver)
    } else if(Array.isArray(project.categories) && project.categories.length > 0) {
        const cats = document.createElement('span')
        cats.className = 'modsCatList'
        cats.textContent = project.categories.filter(c => !['forge', 'fabric', 'neoforge', 'quilt'].includes(c)).slice(0, 3).join(', ')
        if(cats.textContent) meta.appendChild(cats)
    }
    card.appendChild(meta)

    const actions = document.createElement('div')
    actions.className = 'settingsUserModActions'

    const detailsButton = userModsButton('상세보기', () => {
        showUserModDetails(project.projectId || project.slug)
    }, 'nebula-btn-glass')
    actions.appendChild(detailsButton)

    if(installed) {
        const isEnabled = installed.enabled !== false
        const toggleBtn = userModsButton(isEnabled ? '비활성화' : '활성화', async () => {
            toggleBtn.disabled = true
            toggleBtn.textContent = '처리 중...'
            try {
                await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.TOGGLE, installed.projectId, !isEnabled)
                await loadUserMods()
                if(userModsResults.length > 0) renderUserModsResults(userModsResults)
            } catch(err) {
                setUserModsError('모드 상태 변경 실패: ' + err.message)
                toggleBtn.disabled = false
                toggleBtn.textContent = isEnabled ? '비활성화' : '활성화'
            }
        }, isEnabled ? 'nebula-btn-glass' : 'nebula-btn-primary')
        actions.appendChild(toggleBtn)

        const uninstallBtn = userModsButton('삭제', async () => {
            uninstallBtn.disabled = true
            uninstallBtn.textContent = '삭제 중...'
            try {
                await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.DELETE, installed.projectId)
                await loadUserMods()
                if(userModsResults.length > 0) renderUserModsResults(userModsResults)
            } catch(err) {
                setUserModsError('모드 삭제 실패: ' + err.message)
                uninstallBtn.disabled = false
                uninstallBtn.textContent = '삭제'
            }
        }, 'nebula-btn-danger')
        actions.appendChild(uninstallBtn)
    } else {
        const installBtn = userModsButton('설치하기', async () => {
            installBtn.disabled = true
            installBtn.textContent = '설치 중...'
            try {
                await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.INSTALL, {
                    projectId: project.projectId || project.slug
                })
                await loadUserMods()
                if(userModsResults.length > 0) renderUserModsResults(userModsResults)
            } catch(err) {
                setUserModsError('모드 설치 실패: ' + err.message)
                installBtn.disabled = false
                installBtn.textContent = '설치하기'
            }
        }, 'nebula-btn-primary')
        actions.appendChild(installBtn)
    }

    card.appendChild(actions)
    return card
}

function renderUserModsResults(results) {
    const container = document.getElementById('settingsUserModsResults')
    const countBadge = document.getElementById('modsSearchResultCount')
    if(!container) return
    container.innerHTML = ''
    if(countBadge) countBadge.textContent = results.length > 0 ? `(${results.length}개 발견)` : ''

    if(results.length === 0) {
        container.innerHTML = '<div class="modsEmptyNotice">검색 조건에 일치하는 마인크래프트 1.20.1 Forge 모드가 없습니다.</div>'
        return
    }
    results.forEach(project => {
        const pId = project.projectId || project.slug
        const installed = userModsInstalled.find(item => item.projectId === pId || item.slug === pId)
        container.appendChild(renderUserModCard(project, installed))
    })
}

function renderUserModsInstalled() {
    const container = document.getElementById('settingsUserModsInstalled')
    const countBadge = document.getElementById('modsInstalledCount')
    if(!container) return
    container.innerHTML = ''
    if(countBadge) countBadge.textContent = userModsInstalled.length > 0 ? `(${userModsInstalled.length}개)` : '(0개)'

    if(userModsInstalled.length === 0) {
        container.innerHTML = '<div class="modsEmptyNotice">설치된 개인 모드가 없습니다. 위의 검색창에서 JEI, AppleSkin 등을 검색하여 편리하게 원클릭으로 추가해 보세요!</div>'
        return
    }
    userModsInstalled.forEach(mod => {
        container.appendChild(renderUserModCard(mod, mod))
    })
}

async function loadUserMods() {
    try {
        const list = await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.LIST)
        userModsInstalled = Array.isArray(list) ? list : []
    } catch(err) {
        console.error('Failed to list user mods:', err)
        userModsInstalled = []
    }
    renderUserModsInstalled()
}

async function searchUserMods() {
    const requestId = ++userModsSearchRequest
    setUserModsError('')
    const container = document.getElementById('settingsUserModsResults')
    if(container) {
        container.innerHTML = '<div class="modsLoadingIndicator"><div class="modsSpinner"></div><span>Modrinth 모드 검색 중...</span></div>'
    }

    try {
        const query = document.getElementById('settingsUserModsSearch')?.value || ''
        const category = document.getElementById('settingsUserModsCategory')?.value || 'all'
        const sort = document.getElementById('settingsUserModsSort')?.value || 'relevance'

        const response = await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.SEARCH, {
            query,
            category,
            sort
        })
        if(requestId !== userModsSearchRequest) return

        userModsResults = (response && Array.isArray(response.hits)) ? response.hits : []
        renderUserModsResults(userModsResults)
    } catch(err) {
        if(requestId !== userModsSearchRequest) return
        setUserModsError('Modrinth 모드 검색 실패: ' + err.message)
        if(container) {
            container.innerHTML = `<div class="modsEmptyNotice">검색에 실패했습니다: ${escapeHtml(err.message)}</div>`
        }
    }
}

function scheduleUserModsSearch() {
    clearTimeout(userModsSearchTimer)
    userModsSearchTimer = setTimeout(() => {
        searchUserMods()
    }, 300)
}

async function showUserModDetails(projectId) {
    const detailsContainer = document.getElementById('settingsUserModsDetails')
    if(!detailsContainer) return
    detailsContainer.hidden = false
    detailsContainer.innerHTML = '<div class="modsDetailsLoading"><div class="modsSpinner"></div><span>모드 상세 정보 불러오는 중...</span></div>'

    try {
        const data = await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.DETAILS, projectId)
        const project = data?.project
        const versions = Array.isArray(data?.versions) ? data.versions : []
        if(!project) throw new Error('모드 정보를 불러올 수 없습니다.')

        const isInstalled = userModsInstalled.some(m => m.projectId === projectId || m.slug === projectId)

        detailsContainer.innerHTML = `
            <div class="settingsUserModsDetailsCard">
                <div class="settingsUserModsDetailsHeader">
                    ${project.icon_url ? `<img src="${project.icon_url}" alt="" class="settingsUserModIcon">` : '<div class="settingsUserModIconPlaceholder">M</div>'}
                    <div class="settingsUserModsDetailsHeaderTitle">
                        <h3>${escapeHtml(project.title || project.slug)}</h3>
                        <p>${escapeHtml(project.description || '')}</p>
                    </div>
                    <button type="button" class="settingsUserModsDetailsClose nebula-btn-glass" title="닫기 (Esc)">✕ 닫기</button>
                </div>
                <div class="settingsUserModsDetailsMeta">
                    <span>📥 다운로드: ${Number(project.downloads || 0).toLocaleString()}회</span>
                    <span>⭐ 팔로워: ${Number(project.followers || 0).toLocaleString()}명</span>
                    <span>📂 호환 버전 수: ${versions.length}개</span>
                </div>
                <div class="settingsUserModsDetailsInstallBar">
                    ${versions.length > 0 ? `
                        <select id="modsDetailsVersionSelect" class="modsVersionSelect" aria-label="Version to install">
                            ${versions.map(v => `<option value="${v.id}">${escapeHtml(v.name || v.version_number)} (${v.version_number})</option>`).join('')}
                        </select>
                        <button id="modsDetailsInstallBtn" type="button" class="nebula-btn-primary">
                            ${isInstalled ? '이 버전으로 재설치' : '선택 버전 설치하기'}
                        </button>
                    ` : '<span class="modsNoCompatNotice">현재 마인크래프트 1.20.1 Forge에 호환되는 버전이 없습니다.</span>'}
                </div>
                <div class="settingsUserModsDetailsBody">
                    ${project.body ? escapeHtml(project.body.slice(0, 1500)) + (project.body.length > 1500 ? '...' : '') : '상세 설명이 없습니다.'}
                </div>
            </div>
        `

        detailsContainer.querySelector('.settingsUserModsDetailsClose').addEventListener('click', () => {
            detailsContainer.hidden = true
            detailsContainer.innerHTML = ''
        })

        const installBtn = document.getElementById('modsDetailsInstallBtn')
        if(installBtn) {
            installBtn.onclick = async () => {
                const versionSelect = document.getElementById('modsDetailsVersionSelect')
                const versionId = versionSelect?.value
                installBtn.disabled = true
                installBtn.textContent = '설치 중...'
                try {
                    await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.INSTALL, {
                        projectId,
                        versionId
                    })
                    await loadUserMods()
                    if(userModsResults.length > 0) renderUserModsResults(userModsResults)
                    detailsContainer.hidden = true
                    detailsContainer.innerHTML = ''
                } catch(e) {
                    alert('모드 설치 실패: ' + e.message)
                    installBtn.disabled = false
                    installBtn.textContent = '설치 재시도'
                }
            }
        }
    } catch(err) {
        detailsContainer.innerHTML = `
            <div class="settingsUserModsDetailsCard">
                <p style="color: #ef4444;">모드 상세정보 로드 실패: ${escapeHtml(err.message)}</p>
                <button type="button" class="settingsUserModsDetailsClose nebula-btn-glass">닫기</button>
            </div>
        `
        detailsContainer.querySelector('.settingsUserModsDetailsClose').addEventListener('click', () => {
            detailsContainer.hidden = true
            detailsContainer.innerHTML = ''
        })
    }
}

function bindUserModsBrowser() {
    const searchInput = document.getElementById('settingsUserModsSearch')
    const catSelect = document.getElementById('settingsUserModsCategory')
    const sortSelect = document.getElementById('settingsUserModsSort')
    const chkUpdatesBtn = document.getElementById('settingsUserModsCheckUpdates')
    const updAllBtn = document.getElementById('settingsUserModsUpdateAll')

    if(searchInput) {
        searchInput.addEventListener('input', scheduleUserModsSearch)
        searchInput.addEventListener('keydown', (e) => {
            if(e.key === 'Enter') {
                clearTimeout(userModsSearchTimer)
                searchUserMods()
            }
        })
    }
    if(catSelect) catSelect.addEventListener('change', scheduleUserModsSearch)
    if(sortSelect) sortSelect.addEventListener('change', scheduleUserModsSearch)
    if(chkUpdatesBtn) chkUpdatesBtn.addEventListener('click', checkUserModUpdates)
    if(updAllBtn) updAllBtn.addEventListener('click', updateAllUserMods)
}

async function checkUserModUpdates() {
    setUserModsError('모드 업데이트 확인 중...')
    try {
        const updates = await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.CHECK_UPDATES)
        if(!Array.isArray(updates) || !updates.length) {
            setUserModsError('모든 개인 모드가 최신 버전입니다.')
            return
        }
        setUserModsError(`${updates.length}개의 모드에 새로운 업데이트가 있습니다! ("전체 일괄 업데이트" 클릭)`)
    } catch(err) {
        setUserModsError('업데이트 확인 실패: ' + err.message)
    }
}

async function updateAllUserMods() {
    setUserModsError('모든 모드 업데이트 적용 중...')
    try {
        const results = await ipcRenderer.invoke(USER_OPTION_MODS_OPCODE.UPDATE_ALL)
        const count = Array.isArray(results) ? results.length : 0
        setUserModsError(`${count}개 모드가 최신 버전으로 업데이트되었습니다.`)
        await loadUserMods()
    } catch(err) {
        setUserModsError('일괄 업데이트 실패: ' + err.message)
    }
}

/* ==========================================================================
   Tab 2: Server Official Mods
   ========================================================================== */

async function resolveServerModsForUI() {
    try {
        const serv = ConfigManager.getSelectedServer()
        const distro = await DistroAPI.getDistribution()
        const servConf = ConfigManager.getModConfiguration(serv)
        const serverObj = distro.getServerById(serv)

        if(!serverObj || !Array.isArray(serverObj.modules)) return

        const modStr = parseModulesForUI(serverObj.modules, false, servConf ? servConf.mods : null)
        const reqCont = document.getElementById('settingsReqModsContent')
        const optCont = document.getElementById('settingsOptModsContent')
        if(reqCont) reqCont.innerHTML = modStr.reqMods || '<div class="modsEmptyNotice">서버 필수 모드가 없습니다.</div>'
        if(optCont) optCont.innerHTML = modStr.optMods || '<div class="modsEmptyNotice">서버 선택 모드가 없습니다.</div>'
    } catch(e) {
        console.error('Error resolving server mods:', e)
    }
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
}

/* ==========================================================================
   Tab 3: Custom Drop-in Mods (.jar)
   ========================================================================== */

async function resolveDropinModsForUI() {
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        CACHE_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
        CACHE_DROPIN_MODS_LIST = DropinModUtil.scanForDropinMods(CACHE_MODS_DIR, serv.rawServer.minecraftVersion)

        let dropinMods = ''
        for(const dropin of (CACHE_DROPIN_MODS_LIST || [])) {
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
            dropinCont.innerHTML = dropinMods || '<div class="modsEmptyNotice">추가된 외부 모드가 없습니다. 위의 "모드 폴더 열기" 버튼을 눌러 .jar 파일을 추가해 보세요.</div>'
        }
    } catch(e) {
        console.error('Error scanning drop-in mods:', e)
    }
}

function bindDropinModsRemoveButton() {
    const sEls = document.querySelectorAll('#modsContainer [remmod]')
    sEls.forEach(v => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            try {
                const res = await DropinModUtil.deleteDropinMod(CACHE_MODS_DIR, fullName)
                if(res) {
                    const el = document.getElementById(fullName)
                    if(el) el.remove()
                }
            } catch(e) {
                console.error('Failed to delete drop-in mod:', e)
            }
        }
    })
}

function bindDropinModFileSystemButton() {
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    if(fsBtn) {
        fsBtn.onclick = () => {
            if(CACHE_MODS_DIR) {
                DropinModUtil.validateDir(CACHE_MODS_DIR)
                shell.openPath(CACHE_MODS_DIR)
            }
        }
    }
}

function saveDropinModConfiguration() {
    if(!CACHE_DROPIN_MODS_LIST || !CACHE_MODS_DIR) return
    for(const dropin of CACHE_DROPIN_MODS_LIST) {
        const dropinUI = document.getElementById(dropin.fullName)
        if(dropinUI != null) {
            const dropinUIEnabled = dropinUI.hasAttribute('enabled')
            if(DropinModUtil.isDropinModEnabled(dropin.fullName) !== dropinUIEnabled) {
                DropinModUtil.toggleDropinMod(CACHE_MODS_DIR, dropin.fullName, dropinUIEnabled).catch(err => {
                    console.error('Error toggling drop-in mod:', err)
                })
            }
        }
    }
}

/* ==========================================================================
   Tab 4: Shaderpacks
   ========================================================================== */

async function resolveShaderpacksForUI() {
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        CACHE_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
        CACHE_SHADERPACKS_LIST = DropinModUtil.scanForShaderpacks(CACHE_INSTANCE_DIR)
        CACHE_SELECTED_SHADERPACK_NAME = DropinModUtil.getEnabledShaderpack(CACHE_INSTANCE_DIR)

        setShadersOptions(CACHE_SHADERPACKS_LIST, CACHE_SELECTED_SHADERPACK_NAME)
    } catch(e) {
        console.error('Error scanning shaderpacks:', e)
    }
}

function setShadersOptions(arr, selected) {
    const cont = document.getElementById('settingsShadersOptions')
    const selectedDisplay = document.getElementById('settingsShadersSelected')
    if(!cont) return
    cont.innerHTML = ''

    // OFF option
    const offOpt = document.createElement('DIV')
    offOpt.textContent = 'OFF (셰이더 미사용)'
    offOpt.setAttribute('value', 'OFF')
    if(selected === 'OFF' || !selected) {
        offOpt.setAttribute('selected', '')
        if(selectedDisplay) selectedDisplay.textContent = 'OFF (셰이더 미사용)'
    }
    offOpt.addEventListener('click', function() {
        if(selectedDisplay) selectedDisplay.textContent = this.textContent
        for(let sib of cont.children) sib.removeAttribute('selected')
        this.setAttribute('selected', '')
        cont.setAttribute('hidden', '')
        saveShaderpackSettings()
    })
    cont.appendChild(offOpt)

    for(const opt of (arr || [])) {
        const d = document.createElement('DIV')
        d.textContent = opt.name
        d.setAttribute('value', opt.fullName)
        if(opt.fullName === selected) {
            d.setAttribute('selected', '')
            if(selectedDisplay) selectedDisplay.textContent = opt.name
        }
        d.addEventListener('click', function() {
            if(selectedDisplay) selectedDisplay.textContent = this.textContent
            for(let sib of cont.children) sib.removeAttribute('selected')
            this.setAttribute('selected', '')
            cont.setAttribute('hidden', '')
            saveShaderpackSettings()
        })
        cont.appendChild(d)
    }

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
    const opts = document.getElementById('settingsShadersOptions')
    if(opts) {
        for(const opt of opts.children) {
            if(opt.hasAttribute('selected')) {
                sel = opt.getAttribute('value') || 'OFF'
            }
        }
    }
    DropinModUtil.setEnabledShaderpack(CACHE_INSTANCE_DIR, sel)
}

function bindShaderpackButton() {
    const spBtn = document.getElementById('settingsShaderpackButton')
    if(spBtn) {
        spBtn.onclick = () => {
            if(CACHE_INSTANCE_DIR) {
                const p = path.join(CACHE_INSTANCE_DIR, 'shaderpacks')
                DropinModUtil.validateDir(p)
                shell.openPath(p)
            }
        }
    }
}

/* ==========================================================================
   Master Controller: prepareMods()
   ========================================================================== */

async function prepareMods(forceRefresh = false) {
    try {
        const distro = await DistroAPI.getDistribution()
        const selectedServer = distro.getServerById(ConfigManager.getSelectedServer())
        if(selectedServer) {
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
        console.error('Failed to prepare mods UI:', e)
    }
}

window.prepareMods = prepareMods
window.saveAllModsConfig = saveAllModsConfig
window.closeModsView = closeModsView

function initModsBindings() {
    initModsTabs()
    initModsActions()
    bindUserModsBrowser()
}

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModsBindings)
} else {
    initModsBindings()
}
