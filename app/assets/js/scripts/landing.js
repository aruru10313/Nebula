/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const https                   = require('https')
const {
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError
}                             = require('helios-core/common')
const {
    DistributionIndexProcessor,
    MojangIndexProcessor
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
const ReliableRepair          = require('./assets/js/reliablerepair')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')
const avatarImage             = document.getElementById('avatarImage')

const loggerLanding = LoggerUtil.getLogger('Landing')

function loadNewsImageFallback(image, imageUrl){
    return new Promise((resolve, reject) => {
        let parsedImageUrl
        try {
            parsedImageUrl = new URL(imageUrl)
        } catch(error) {
            reject(error)
            return
        }

        if(parsedImageUrl.protocol !== 'https:' || parsedImageUrl.hostname !== 'mc.aruru.kr'){
            reject(new Error('News image host is not allowed'))
            return
        }

        const request = https.get(parsedImageUrl, {
            headers: {
                Accept: 'image/*'
            }
        }, response => {
            if(response.statusCode !== 200){
                response.resume()
                reject(new Error(`News image request failed with status ${response.statusCode}`))
                return
            }

            const contentType = String(response.headers['content-type'] || '').split(';', 1)[0].toLowerCase()
            if(!/^image\/(?:png|jpe?g|webp|gif)$/.test(contentType)){
                response.resume()
                reject(new Error('News image response was not an allowed image type'))
                return
            }

            const chunks = []
            let totalBytes = 0
            response.on('data', chunk => {
                totalBytes += chunk.length
                if(totalBytes > 8 * 1024 * 1024){
                    response.destroy(new Error('News image exceeds the 8 MB limit'))
                    return
                }
                chunks.push(chunk)
            })
            response.on('end', () => {
                image.src = `data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`
                resolve()
            })
            response.on('error', reject)
        })
        request.setTimeout(5000, () => request.destroy(new Error('News image request timed out')))
        request.on('error', reject)
    })
}

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind mods quick-access button (jumps straight to Settings > Mods, avoiding
// the extra step of opening Settings then hunting for the Mods tab).
document.getElementById('modsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavMods'), false)
    })
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    avatarImage.onerror = null
    avatarImage.src = './assets/images/nebula-icon.png'
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        const uuid = typeof authUser.uuid === 'string' ? authUser.uuid.trim() : ''
        if(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(uuid)){
            avatarImage.src = `https://mc-heads.net/avatar/${encodeURIComponent(uuid.replace(/-/g, ''))}/100.png`
            avatarImage.onerror = () => {
                avatarImage.onerror = null
                avatarImage.src = './assets/images/nebula-icon.png'
            }
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.selectedServer.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {
        const distribution = await Promise.race([
            DistroAPI.getDistribution(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Distribution request timed out.')), 10000))
        ])
        const serv = distribution.getServerById(ConfigManager.getSelectedServer())
        if(serv == null) {
            throw new Error('No selected server is available.')
        }
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, showing offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

// Server Status is refreshed in uibinder.js on distributionIndexDone.
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
        try {
            await downloadJava(effectiveJavaOptions, launchAfter)
        } catch(err) {
            loggerLanding.error('Unhandled error in automatic Java download', err)
            showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), err.displayable || Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
        }
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    await ReliableRepair.downloadAsset(asset, ({ transferred }) => {
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    await asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    window.nebulaDownloadUpdates = async function() {
        const distro = await DistroAPI.refreshDistributionOrFallback()
        const serverId = ConfigManager.getSelectedServer()
        const repair = new ReliableRepair(
            ConfigManager.getCommonDirectory(),
            ConfigManager.getInstanceDirectory(),
            ConfigManager.getLauncherDirectory(),
            serverId,
            DistroAPI.isDevMode(),
            distro
        )

        repair.spawnReceiver()
        try {
            const invalidFileCount = await repair.verifyFiles(() => {})
            if(invalidFileCount > 0) {
                await repair.download(percent => {
                    remote.getCurrentWindow().setProgressBar(percent / 100)
                })
            }
            loggerLanding.info(`Nebula content update complete for ${serverId}.`)
            return distro
        } finally {
            remote.getCurrentWindow().setProgressBar(-1)
            repair.destroyReceiver()
        }
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new ReliableRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode(),
        distro
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            proc.on('error', (err) => {
                loggerLaunchSuite.error('Unable to start Minecraft process.', err)
                showLaunchFailure(
                    Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
                    err.message || Lang.queryJS('landing.dlAsync.checkConsoleForDetails')
                )
            })

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const newsScrollTop                 = document.getElementById('newsScrollTop')
const newsBackButton               = document.getElementById('newsBackButton')
const nELoadSpan                    = document.getElementById('nELoadSpan')

newsScrollTop.onclick = () => {
    newsArticleContentScrollable.scrollTo({ top: 0, behavior: 'smooth' })
}

// News slide caches.
let newsActive = false
let newsGlideCount = 0

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        //date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})
        //landingContainer.style.background = 'rgba(29, 29, 29, 0.55)'
        landingContainer.style.background = 'rgba(0, 0, 0, 0.50)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}

newsBackButton.onclick = () => {
    if(newsActive){
        document.getElementById('newsButton').click()
    }
}

document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape' && newsActive){
        newsBackButton.click()
    }
})

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function safeNewsUrl(value){
    try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#'
    } catch(_err) {
        return '#'
    }
}

function sanitizeNewsHtml(value){
    const template = document.createElement('template')
    template.innerHTML = String(value || '')
    const allowedTags = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'EM', 'I', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'U', 'UL'])
    const allowedAttributes = new Set(['href', 'title'])

    const walk = (parent) => {
        Array.from(parent.childNodes).forEach((node) => {
            if(node.nodeType === Node.COMMENT_NODE){
                node.remove()
                return
            }
            if(node.nodeType !== Node.ELEMENT_NODE){
                return
            }
            if(!allowedTags.has(node.tagName)){
                node.replaceWith(document.createTextNode(node.textContent || ''))
                return
            }
            Array.from(node.attributes).forEach((attribute) => {
                if(!allowedAttributes.has(attribute.name.toLowerCase())){
                    node.removeAttribute(attribute.name)
                }
            })
            if(node.tagName === 'A'){
                const href = safeNewsUrl(node.getAttribute('href'))
                if(href === '#'){
                    node.removeAttribute('href')
                } else {
                    node.setAttribute('href', href)
                }
            }
            walk(node)
        })
    }

    walk(template.content)
    return template.content
}

function displayArticle(articleObject, index){
    newsArticleTitle.textContent = articleObject.title
    newsArticleTitle.href = safeNewsUrl(articleObject.link)
    newsArticleAuthor.textContent = 'by ' + articleObject.author
    newsArticleDate.textContent = articleObject.date
    newsArticleComments.textContent = articleObject.comments
    newsArticleComments.href = safeNewsUrl(articleObject.commentsLink)
    newsArticleContentScrollable.replaceChildren()
    const articleWrapper = document.createElement('div')
    articleWrapper.id = 'newsArticleContentWrapper'
    const topSpacer = document.createElement('div')
    topSpacer.className = 'newsArticleSpacerTop'
    articleWrapper.append(topSpacer)
    if(articleObject.imageUrl){
        const image = document.createElement('img')
        image.className = 'newsArticleImage'
        image.src = articleObject.imageUrl
        image.alt = articleObject.title || 'Nebula announcement'
        image.loading = 'lazy'
        image.referrerPolicy = 'no-referrer'
        image.addEventListener('error', () => {
            loadNewsImageFallback(image, articleObject.imageUrl).catch(error => {
                loggerLanding.warn(`Unable to load news image: ${error.message}`)
                image.remove()
            })
        }, { once: true })
        articleWrapper.append(image)
    }
    const articleBody = document.createElement('div')
    articleBody.className = 'newsArticleBody'
    articleBody.style.fontSize = `${articleObject.fontSize || 16}px`
    articleBody.append(sanitizeNewsHtml(articleObject.content))
    articleWrapper.append(articleBody)
    const bottomSpacer = document.createElement('div')
    bottomSpacer.className = 'newsArticleSpacerBot'
    articleWrapper.append(bottomSpacer)
    newsArticleContentScrollable.append(articleWrapper)
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load the current announcements from the Nebula API.
 *
 * The API is the source of truth. It is retried once with a generous timeout
 * because the news service may briefly cold-start after an idle period.
 */
async function loadNews(){
    const requestNews = () => new Promise((resolve) => {
        $.ajax({
            url: 'https://mc.aruru.kr/api/v1/news?limit=20',
            dataType: 'json',
            timeout: 10000,
            success: (data) => resolve(data),
            error: (_xhr, status, error) => {
                loggerLanding.warn(`News API request failed (${status || error || 'unknown error'}).`)
                resolve(null)
            }
        })
    })

    let apiNews = null
    for(let attempt = 0; attempt < 2 && apiNews == null; attempt++){
        apiNews = await requestNews()
        if(apiNews == null && attempt === 0){
            await new Promise(resolve => setTimeout(resolve, 350))
        }
    }

    if(apiNews && Array.isArray(apiNews.announcements)){
        const escapeHtml = (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')

        return {
            articles: apiNews.announcements.map((announcement) => {
                const title = escapeHtml(announcement.title)
                const body = escapeHtml(announcement.body).replace(/\r?\n/g, '<br>')
                let imageUrl = null
                if(typeof announcement.imageUrl === 'string' && announcement.imageUrl.length > 0){
                    try {
                        const parsedImageUrl = new URL(announcement.imageUrl, 'https://mc.aruru.kr')
                        if(parsedImageUrl.protocol === 'https:' && parsedImageUrl.hostname === 'mc.aruru.kr'){
                            imageUrl = parsedImageUrl.href
                        }
                    } catch(_err) {
                        imageUrl = null
                    }
                }
                const date = new Date(announcement.publishedAt)
                const formattedDate = Number.isNaN(date.valueOf())
                    ? ''
                    : date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric'
                    })

                return {
                    link: 'https://mc.aruru.kr/#announcements',
                    title,
                    date: formattedDate,
                    author: 'Nebula',
                    content: body,
                    imageUrl,
                    fontSize: Number.isInteger(announcement.fontSize)
                        ? Math.min(Math.max(announcement.fontSize, 12), 32)
                        : 16,
                    comments: '0 Comments',
                    commentsLink: 'https://mc.aruru.kr/#announcements'
                }
            })
        }
    }

    loggerLanding.warn('News API unavailable; showing the launcher news error state.')
    return null
}

window.nebulaLandingReady = true
