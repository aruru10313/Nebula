const platform = navigator.platform.toLowerCase()
const current = platform.includes('win') ? 'windows' : platform.includes('mac') ? 'macos' : platform.includes('linux') ? 'linux' : null
document.querySelectorAll('[data-platform]').forEach(card => {
    if(card.dataset.platform === current) {
        card.classList.add('recommended')
        const label = document.createElement('em')
        label.textContent = 'Recommended for your device'
        card.prepend(label)
    }
})
