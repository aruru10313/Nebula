const path = require('node:path')
const { defineConfig } = require('vite')
const react = require('@vitejs/plugin-react')

module.exports = defineConfig({
    root: path.resolve(__dirname, 'src/admin-app'),
    base: '/aruru/admin/',
    plugins: [react()],
    build: {
        outDir: path.resolve(__dirname, 'admin-dist'),
        emptyOutDir: true
    }
})
