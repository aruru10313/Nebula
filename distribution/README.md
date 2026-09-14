# Nebula distribution server

Nebula downloads its Minecraft client files from the URL configured in
`app/assets/js/distromanager.js`. Replace the example host there with your
Oracle/Nginx hostname before building. The launcher expects a static HTTPS server
containing `distribution.json`, the generated mod files, and the Forge version
manifest.

Generate the manifest from the Minecraft server folder:

```bash
NEBULA_ASSET_BASE_URL=https://launcher.example.com/nebula \
NEBULA_SERVER_ADDRESS=play.example.com:25565 \
npm run generate:distribution
```

For automatic detection while the server/modpack is being edited:

```bash
NEBULA_ASSET_BASE_URL=https://launcher.example.com/nebula \
NEBULA_SERVER_ADDRESS=play.example.com:25565 \
NEBULA_DEPLOY_DIR=/var/www/nebula \
npm run watch:distribution
```

The watcher detects added, removed, and replaced `.jar` files, increments the
server-pack revision, regenerates the manifest, removes stale published files,
and synchronizes the result to `NEBULA_DEPLOY_DIR`. Point Nginx or Oracle
Object Storage publication at that directory. For Object Storage, sync that
directory with the OCI CLI after each generated revision.

The generator reads `../mods`, excludes the server-only economy mod and
Fabric API, calculates file sizes and MD5 checksums, and creates:

- `distribution/distribution.json`
- `distribution/repo/versions/1.20.1-forge-47.4.23.json` (copy the generated Forge manifest here)
- `distribution/servers/Nebula-1.20.1/mods/*.jar`

Upload the generated files to Oracle Cloud Object Storage, an Oracle VPS with
Nginx, or another HTTPS static host. Do not expose the Minecraft server's
whole filesystem; publish only this distribution directory and the selected
client mods.
