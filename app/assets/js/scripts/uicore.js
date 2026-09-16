/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')
const ConfigManager                  = require('./assets/js/configmanager')
const { DistroAPI }                  = require('./assets/js/distromanager')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('NebulaUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

let nebulaUpdateCheckListener
let nebulaDistributionVersion = null

async function checkNebulaUpdates(showResult = false) {
    try {
        const distro = await DistroAPI.refreshDistributionOrFallback()
        const server = distro.getServerById(ConfigManager.getSelectedServer())
        const modCount = server.modules.filter(module => module.rawModule.type === 'ForgeMod').length
        nebulaDistributionVersion = distro.rawDistribution?.version || server.rawServer.version
        loggerAutoUpdater.info(`Nebula content revision ${nebulaDistributionVersion}, ${modCount} client mods`)
        if(showResult && typeof prepareUpdateTab === 'function') {
            prepareUpdateTab({
                version: nebulaDistributionVersion,
                releaseName: Lang.queryJS('settings.updates.nebulaReadyTitle'),
                releaseNotes: Lang.queryJS('settings.updates.nebulaReadyDescription', { modCount }),
                nebula: true
            })
        }
        return { version: nebulaDistributionVersion, modCount }
    } catch(err) {
        loggerAutoUpdater.error('Nebula content update check failed.', err)
        if(showResult && typeof prepareUpdateTab === 'function') {
            prepareUpdateTab({ error: true })
        }
        throw err
    }
}

window.checkNebulaUpdates = checkNebulaUpdates
nebulaUpdateCheckListener = setInterval(() => checkNebulaUpdates(), 1800000)

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    loggerAutoUpdater.info(`Ignoring launcher prerelease setting: ${val}`)
}

function showUpdateUI(info){
    //TODO Make this message a bit more informative `${info.version}`
    loggerUICore.info(`Launcher update available: ${info?.version ?? 'unknown'}`)
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Remove the rounded clip while a frameless window is maximized.
        const currentWindow = remote.getCurrentWindow()
        const syncWindowShape = () => {
            const maximized = currentWindow.isMaximized()
            document.body.classList.toggle('window-maximized', maximized)
            document.documentElement.classList.toggle('window-maximized', maximized)
        }
        currentWindow.on('maximize', syncWindowShape)
        currentWindow.on('unmaximize', syncWindowShape)
        syncWindowShape()

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                setTimeout(syncWindowShape, 0)
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        document.getElementById('launch_details').style.removeProperty('max-width')
        document.getElementById('launch_progress').style.removeProperty('width')
        document.getElementById('launch_details_right').style.removeProperty('max-width')
        document.getElementById('launch_progress_label').style.removeProperty('width')
        
    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})
