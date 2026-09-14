const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const ejse                              = require('ejs-electron')
const { autoUpdater }                   = require('electron-updater')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const { pathToFileURL }                 = require('url')
const {
    AZURE_CLIENT_ID,
    LAUNCHER_UPDATE_EVENT,
    LAUNCHER_UPDATE_OPCODE,
    MSFT_OPCODE,
    MSFT_REPLY_TYPE,
    MSFT_ERROR,
    SHELL_OPCODE,
    USER_OPTION_MODS_OPCODE,
    DISTRIBUTION_CLEANUP_OPCODE
} = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')
const ModrinthAPI                       = require('./app/assets/js/modrinthapi')
const DistributionCleanup               = require('./app/assets/js/distributioncleanup')

// Setup Lang
LangLoader.setupLanguage()

let distributionIndexResult = null

// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    distributionIndexResult = Boolean(res)
    if(win && !win.isDestroyed()) {
        win.webContents.send('distributionIndexDone', distributionIndexResult)
    }
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

function getUserModsDirectory() {
    return app.getPath('userData')
}

ipcMain.handle(USER_OPTION_MODS_OPCODE.SEARCH, (_event, params) => ModrinthAPI.search(params))
ipcMain.handle(USER_OPTION_MODS_OPCODE.DETAILS, (_event, projectId) => ModrinthAPI.getDetails(projectId))
ipcMain.handle(USER_OPTION_MODS_OPCODE.LIST, () => ModrinthAPI.listInstalled(getUserModsDirectory()))
ipcMain.handle(USER_OPTION_MODS_OPCODE.INSTALL, (_event, params) => ModrinthAPI.install(getUserModsDirectory(), params))
ipcMain.handle(USER_OPTION_MODS_OPCODE.TOGGLE, (_event, projectId, enabled) => ModrinthAPI.setEnabled(getUserModsDirectory(), projectId, enabled))
ipcMain.handle(USER_OPTION_MODS_OPCODE.DELETE, (_event, projectId) => ModrinthAPI.remove(getUserModsDirectory(), projectId))
ipcMain.handle(USER_OPTION_MODS_OPCODE.CHECK_UPDATES, () => ModrinthAPI.checkUpdates(getUserModsDirectory()))
ipcMain.handle(USER_OPTION_MODS_OPCODE.UPDATE, (_event, projectId) => ModrinthAPI.update(getUserModsDirectory(), projectId))
ipcMain.handle(USER_OPTION_MODS_OPCODE.UPDATE_ALL, () => ModrinthAPI.updateAll(getUserModsDirectory()))
ipcMain.handle(DISTRIBUTION_CLEANUP_OPCODE.SCAN, () => DistributionCleanup.scanUnreferencedFiles())
ipcMain.handle(DISTRIBUTION_CLEANUP_OPCODE.DELETE, (_event, scanResult, confirmation) => DistributionCleanup.deleteUnreferencedFiles(scanResult, confirmation))

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('nebula-icon')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queryMap = {}
            
            new URL(uri).searchParams.forEach((v, k) => {
                queryMap[k] = v
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('nebula-icon')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

const launcherUpdaterState = {
    status: 'disabled',
    version: null,
    progress: null,
    error: null
}
let launcherUpdaterInitialized = false
let launcherUpdateCheckPromise = null
let launcherUpdatePromptShown = false

function getLauncherUpdateStatus() {
    return {
        source: 'launcher',
        status: launcherUpdaterState.status,
        version: launcherUpdaterState.version,
        progress: launcherUpdaterState.progress,
        error: launcherUpdaterState.error
    }
}

function sendLauncherUpdateStatus(status, details = {}) {
    launcherUpdaterState.status = status
    launcherUpdaterState.version = details.version ?? launcherUpdaterState.version
    launcherUpdaterState.progress = details.progress ?? null
    launcherUpdaterState.error = details.error ?? null

    const payload = {
        ...getLauncherUpdateStatus(),
        ...details
    }
    if(payload.error && !payload.message) {
        payload.message = payload.error.message
    }

    if(win && !win.isDestroyed()) {
        win.webContents.send(LAUNCHER_UPDATE_EVENT, payload)
    }
}

function serializeUpdateError(error, fallbackCode = 'LAUNCHER_UPDATE_FAILED') {
    return {
        code: error?.code || fallbackCode,
        message: error?.message || String(error)
    }
}

function createUpdateError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function ensureLauncherUpdaterAvailable() {
    if(isDev || !app.isPackaged) {
        throw createUpdateError(
            'LAUNCHER_UPDATE_UNAVAILABLE_IN_DEVELOPMENT',
            'Launcher updates are only available in a packaged build.'
        )
    }
    if(!launcherUpdaterInitialized) {
        throw createUpdateError(
            'LAUNCHER_UPDATE_NOT_READY',
            'The launcher updater has not finished initializing.'
        )
    }
}

async function checkForLauncherUpdate() {
    ensureLauncherUpdaterAvailable()

    if(launcherUpdateCheckPromise) {
        return launcherUpdateCheckPromise
    }

    sendLauncherUpdateStatus('checking')
    launcherUpdateCheckPromise = Promise.resolve()
        .then(() => autoUpdater.checkForUpdates())
        .then(result => {
            if(result?.updateInfo && launcherUpdaterState.status === 'checking') {
                sendLauncherUpdateStatus('available', {
                    version: result.updateInfo.version,
                    releaseDate: result.updateInfo.releaseDate || null
                })
            } else if(!result?.updateInfo && launcherUpdaterState.status === 'checking') {
                sendLauncherUpdateStatus('not-available', {
                    version: app.getVersion()
                })
            }
            return {
                status: result?.updateInfo ? 'available' : launcherUpdaterState.status,
                version: result?.updateInfo?.version || launcherUpdaterState.version,
                currentVersion: app.getVersion()
            }
        })
        .catch(error => {
            if(launcherUpdaterState.status !== 'error') {
                sendLauncherUpdateStatus('error', {
                    error: serializeUpdateError(error)
                })
            }
            throw error
        })
        .finally(() => {
            launcherUpdateCheckPromise = null
        })

    return launcherUpdateCheckPromise
}

ipcMain.handle(LAUNCHER_UPDATE_OPCODE.CHECK, async () => {
    try {
        return await checkForLauncherUpdate()
    } catch(error) {
        const updateError = serializeUpdateError(error)
        throw createUpdateError(updateError.code, updateError.message)
    }
})

ipcMain.handle(LAUNCHER_UPDATE_OPCODE.GET_STATUS, () => getLauncherUpdateStatus())
ipcMain.handle(LAUNCHER_UPDATE_OPCODE.SET_AUTO_DOWNLOAD, (_event, enabled) => {
    ensureLauncherUpdaterAvailable()
    if(typeof enabled !== 'boolean') {
        throw new TypeError('Automatic launcher update setting must be a boolean.')
    }
    autoUpdater.autoDownload = enabled
    return { autoDownload: enabled }
})

ipcMain.handle(LAUNCHER_UPDATE_OPCODE.INSTALL, () => {
    ensureLauncherUpdaterAvailable()
    if(launcherUpdaterState.status !== 'downloaded') {
        throw createUpdateError(
            'LAUNCHER_UPDATE_NOT_DOWNLOADED',
            'There is no downloaded launcher update to install.'
        )
    }
    try {
        autoUpdater.quitAndInstall()
    } catch(error) {
        const updateError = serializeUpdateError(error, 'LAUNCHER_UPDATE_INSTALL_FAILED')
        sendLauncherUpdateStatus('error', {
            error: updateError
        })
        throw createUpdateError(updateError.code, updateError.message)
    }
    return { status: 'installing' }
})

function setupLauncherUpdater() {
    if(isDev || !app.isPackaged || launcherUpdaterInitialized) {
        if(isDev || !app.isPackaged) {
            launcherUpdaterState.status = 'disabled'
        }
        return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => {
        sendLauncherUpdateStatus('checking')
    })
    autoUpdater.on('update-available', (info) => {
        sendLauncherUpdateStatus('available', {
            version: info.version,
            releaseDate: info.releaseDate || null
        })
    })
    autoUpdater.on('download-progress', (progress) => {
        sendLauncherUpdateStatus('downloading', {
            progress: {
                percent: progress.percent,
                transferred: progress.transferred,
                total: progress.total,
                bytesPerSecond: progress.bytesPerSecond
            }
        })
    })
    autoUpdater.on('update-not-available', (info) => {
        sendLauncherUpdateStatus('not-available', {
            version: info?.version || app.getVersion()
        })
    })
    autoUpdater.on('update-downloaded', async (info) => {
        sendLauncherUpdateStatus('downloaded', {
            version: info.version,
            releaseDate: info.releaseDate || null
        })

        if(launcherUpdatePromptShown || !win || win.isDestroyed()) {
            return
        }
        launcherUpdatePromptShown = true

        try {
            const result = await dialog.showMessageBox(win, {
                type: 'info',
                buttons: ['지금 재시작', '나중에'],
                defaultId: 0,
                cancelId: 1,
                title: 'Nebula 업데이트 준비 완료',
                message: `Nebula ${info.version} 업데이트가 다운로드되었습니다.`,
                detail: '지금 재시작하면 업데이트가 설치됩니다.'
            })
            if(result.response === 0) {
                autoUpdater.quitAndInstall()
            }
        } catch(error) {
            sendLauncherUpdateStatus('error', {
                error: serializeUpdateError(error, 'LAUNCHER_UPDATE_INSTALL_FAILED')
            })
        }
    })
    autoUpdater.on('error', (error) => {
        sendLauncherUpdateStatus('error', {
            error: serializeUpdateError(error)
        })
    })
    launcherUpdaterInitialized = true
    launcherUpdaterState.status = 'idle'

    setTimeout(() => {
        checkForLauncherUpdate().catch((error) => {
            console.warn('Nebula launcher update check failed:', error.message)
        })
    }, 5000)
}

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('nebula-icon'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)
    win.webContents.on('before-input-event', (event, input) => {
        const key = input.key.toLowerCase()
        if((input.control && input.shift && key === 'i') || key === 'f12') {
            event.preventDefault()
        }
    })

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())
    win.webContents.once('did-finish-load', () => {
        if(distributionIndexResult !== null && win && !win.isDestroyed()) {
            win.webContents.send('distributionIndexDone', distributionIndexResult)
        }
    })

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)
app.on('ready', setupLauncherUpdater)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
