# Nebula downloads site

This is a static download and legal-information site for the Oracle-hosted website.
Upload the contents of this directory to the web root (for example `/var/www/nebula`)
and configure Nginx to serve `index.html`.

`site.js` reads the latest GitHub Release through the public GitHub API and updates
the Windows, Linux, and macOS download links and version label at page load. If the
API is unavailable, the cards fall back to the GitHub Releases page instead of a
stale versioned asset URL.

If the site is served with a restrictive Content-Security-Policy, its `connect-src`
must allow `https://api.github.com` for this lookup.

The launcher itself continues to use electron-updater for in-app updates.
