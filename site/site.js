const platform = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase()
const current = platform.includes('win') ? 'windows' : platform.includes('mac') ? 'macos' : platform.includes('linux') ? 'linux' : null
document.querySelectorAll('[data-platform]').forEach(card => {
    if(card.dataset.platform === current) {
        card.classList.add('recommended')
        const label = card.querySelector('.recommended-label')
        if (label) label.hidden = false
    }
})

const releaseRepository = 'https://api.github.com/repos/aruru10313/Nebula/releases/latest'
const releasePage = 'https://github.com/aruru10313/Nebula/releases/latest'
const releaseVersion = document.querySelector('#release-version')
const releaseAssetPatterns = {
    windows: /^Nebula-setup-[^/]+\.exe$/,
    macos: /^Nebula-Launcher-setup-[^/]+-x64\.dmg$/,
    linux: /^Nebula-setup-[^/]+\.AppImage$/
}

function useReleaseFallback() {
    document.querySelectorAll('[data-release-asset]').forEach(link => {
        link.href = releasePage
    })
    if (releaseVersion) {
        releaseVersion.textContent = '릴리스 페이지에서 확인'
        releaseVersion.classList.add('is-fallback')
    }
}

fetch(releaseRepository, {
    headers: { accept: 'application/vnd.github+json' }
})
    .then(response => {
        if (!response.ok) throw new Error('release request failed')
        return response.json()
    })
    .then(release => {
        const assets = Array.isArray(release.assets) ? release.assets : []
        const version = String(release.tag_name || '').replace(/^v/, '')
        if (!version) throw new Error('release version missing')

        Object.entries(releaseAssetPatterns).forEach(([platformName, pattern]) => {
            const asset = assets.find(candidate => pattern.test(candidate.name))
            const link = document.querySelector(`[data-release-asset="${platformName}"]`)
            if (asset && link) {
                link.href = asset.browser_download_url
            }
        })
        if (releaseVersion) {
            releaseVersion.textContent = version
            releaseVersion.classList.remove('is-fallback')
        }
    })
    .catch(() => {
        useReleaseFallback()
    })

const announcementList = document.querySelector('#announcement-list')
if (announcementList) {
    fetch('/api/v1/news?limit=5', { headers: { accept: 'application/json' } })
        .then(response => {
            if (!response.ok) throw new Error('news request failed')
            return response.json()
        })
        .then(data => {
            announcementList.replaceChildren()
            const announcements = Array.isArray(data.announcements) ? data.announcements : []
            if (!announcements.length) {
                const empty = document.createElement('p')
                empty.className = 'muted'
                empty.textContent = '등록된 공지가 없습니다.'
                announcementList.append(empty)
                return
            }
            announcements.forEach(item => {
                const article = document.createElement('article')
                article.className = 'announcement-card'
                if (item.imageUrl) {
                    const image = document.createElement('img')
                    image.src = item.imageUrl
                    image.alt = ''
                    image.referrerPolicy = 'no-referrer'
                    article.append(image)
                }
                const title = document.createElement('h3')
                title.textContent = item.title
                const date = document.createElement('time')
                date.dateTime = item.publishedAt
                date.textContent = new Date(item.publishedAt).toLocaleDateString('ko-KR')
                const body = document.createElement('p')
                body.textContent = item.body
                body.style.fontSize = `${Number.isInteger(item.fontSize) ? Math.min(Math.max(item.fontSize, 12), 32) : 16}px`
                article.append(title, date, body)
                announcementList.append(article)
            })
        })
        .catch(() => {
            announcementList.replaceChildren()
            const error = document.createElement('p')
            error.className = 'muted'
            error.textContent = '공지를 불러오지 못했습니다.'
            announcementList.append(error)
        })
}
