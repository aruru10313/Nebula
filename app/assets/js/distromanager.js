const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const REQUIRED_MINECRAFT_VERSION = '1.20.1'
const REQUIRED_FORGE_VERSION = '47.4.23'

// Host this file and the generated mod assets on the Nebula distribution server.
exports.REMOTE_DISTRO_URL = process.env.NEBULA_DISTRIBUTION_URL || 'https://mc.aruru.kr/nebula/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

const getDistribution = api.getDistribution.bind(api)
const validateDistribution = distribution => {
    for(const server of distribution.servers) {
        if(server.rawServer.minecraftVersion !== REQUIRED_MINECRAFT_VERSION) {
            throw new Error(`Nebula only supports Minecraft ${REQUIRED_MINECRAFT_VERSION}. Received ${server.rawServer.minecraftVersion}.`)
        }

        const forgeModule = server.modules.find(module => module.rawModule.type === 'ForgeHosted' || module.rawModule.type === 'Forge')
        if(forgeModule == null || !forgeModule.rawModule.id.includes(`-${REQUIRED_FORGE_VERSION}`)) {
            throw new Error(`Nebula requires Forge ${REQUIRED_FORGE_VERSION} for Minecraft ${REQUIRED_MINECRAFT_VERSION}.`)
        }
    }
    return distribution
}
api.getDistribution = async function() {
    return validateDistribution(await getDistribution())
}
const refreshDistributionOrFallback = api.refreshDistributionOrFallback.bind(api)
api.refreshDistributionOrFallback = async function() {
    return validateDistribution(await refreshDistributionOrFallback())
}

exports.DistroAPI = api