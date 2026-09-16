// Detect Client OS
const platformInfo = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase()
const detectedOS = platformInfo.includes('win')
    ? 'windows'
    : platformInfo.includes('mac')
        ? 'macos'
        : platformInfo.includes('linux')
            ? 'linux'
            : null

if (detectedOS) {
    const targetCard = document.querySelector(`[data-platform="${detectedOS}"]`)
    if (targetCard) {
        targetCard.classList.add('recommended')
        const recBadge = targetCard.querySelector('.rec-badge')
        if (recBadge) recBadge.hidden = false
    }
}

// Toast Utility
function showToast(message) {
    const toast = document.getElementById('toast')
    if (!toast) return
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toast._timer)
    toast._timer = setTimeout(() => {
        toast.classList.remove('show')
    }, 2500)
}

// Copy Server IP
const copyBtn = document.getElementById('copy-ip-btn')
if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
        const ip = 'comet.aruru.kr'
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(ip)
            } else {
                const tempInput = document.createElement('input')
                tempInput.value = ip
                document.body.appendChild(tempInput)
                tempInput.select()
                document.execCommand('copy')
                document.body.removeChild(tempInput)
            }
            copyBtn.classList.add('copied')
            showToast('서버 주소(comet.aruru.kr)가 클립보드에 복사되었습니다! ✨')
            setTimeout(() => copyBtn.classList.remove('copied'), 2000)
        } catch (_err) {
            showToast('주소 복사에 실패했습니다. comet.aruru.kr를 직접 입력해주세요.')
        }
    })
}

// GitHub Releases API
const releaseRepo = 'https://api.github.com/repos/aruru10313/Nebula/releases/latest'
const fallbackReleasePage = 'https://github.com/aruru10313/Nebula/releases/latest'
const releaseVersionEl = document.querySelector('#release-version')

const assetPatterns = {
    windows: /^Nebula-setup-[^/]+\.exe$/i,
    macos: /^Nebula-Launcher-setup-[^/]+-(?:x64|arm64)\.dmg$/i,
    linux: /^Nebula-setup-[^/]+\.AppImage$/i
}

function applyFallbackReleaseLinks() {
    document.querySelectorAll('[data-release-asset]').forEach(link => {
        link.href = fallbackReleasePage
    })
    if (releaseVersionEl) {
        releaseVersionEl.textContent = '최신 버전 확인'
    }
}

fetch(releaseRepo, {
    headers: { accept: 'application/vnd.github+json' }
})
    .then(res => {
        if (!res.ok) throw new Error('Release fetch failed')
        return res.json()
    })
    .then(data => {
        const assets = Array.isArray(data.assets) ? data.assets : []
        const version = String(data.tag_name || '').trim()
        if (!version) throw new Error('Tag name not found')

        if (releaseVersionEl) {
            releaseVersionEl.textContent = version.startsWith('v') ? version : `v${version}`
        }

        Object.entries(assetPatterns).forEach(([platform, pattern]) => {
            const matched = assets.find(candidate => pattern.test(candidate.name))
            const link = document.querySelector(`[data-release-asset="${platform}"]`)
            if (matched && link) {
                link.href = matched.browser_download_url
            }
        })
    })
    .catch(() => {
        applyFallbackReleaseLinks()
    })

// Load News / Announcements
const newsList = document.querySelector('#announcement-list')
if (newsList) {
    fetch('/api/v1/news?limit=5', {
        headers: { accept: 'application/json' }
    })
        .then(res => {
            if (!res.ok) throw new Error('News fetch failed')
            return res.json()
        })
        .then(data => {
            newsList.replaceChildren()
            const announcements = Array.isArray(data.announcements) ? data.announcements : []
            if (!announcements.length) {
                const empty = document.createElement('div')
                empty.className = 'announcement-card'
                empty.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin: 0;">등록된 공지사항이 없습니다.</p>'
                newsList.append(empty)
                return
            }

            announcements.forEach(item => {
                const article = document.createElement('article')
                article.className = 'announcement-card'

                if (item.imageUrl) {
                    const img = document.createElement('img')
                    img.src = item.imageUrl
                    img.alt = ''
                    img.loading = 'lazy'
                    img.referrerPolicy = 'no-referrer'
                    article.append(img)
                }

                const title = document.createElement('h3')
                title.textContent = item.title

                const date = document.createElement('time')
                date.dateTime = item.publishedAt
                date.textContent = new Date(item.publishedAt).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })

                const body = document.createElement('p')
                body.textContent = item.body
                if (Number.isInteger(item.fontSize)) {
                    body.style.fontSize = `${Math.min(Math.max(item.fontSize, 12), 24)}px`
                }

                article.append(title, date, body)
                newsList.append(article)
            })
        })
        .catch(() => {
            newsList.replaceChildren()
            const errCard = document.createElement('div')
            errCard.className = 'announcement-card'
            errCard.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin: 0;">공지사항을 불러오지 못했습니다.</p>'
            newsList.append(errCard)
        })
}
