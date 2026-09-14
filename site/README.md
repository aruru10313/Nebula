# Nebula downloads site

This is a static download and legal-information site for the Oracle-hosted website.
Upload the contents of this directory to the web root (for example `/var/www/nebula`)
and configure Nginx to serve `index.html`.

The download links point to the latest GitHub Release assets:

- Windows: `Nebula-setup-2.0.0.exe`
- Linux: `Nebula-setup-2.0.0.AppImage`
- macOS: `Nebula Launcher-setup-2.0.0-x64.dmg`

When the product version changes, update the three asset URLs and the release label
in `index.html`. The launcher itself continues to use electron-updater for in-app
updates.
