import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, services } = await buildApp(config, { logger: true });

app.log.info(`Data directory: ${config.dataDir}`);
app.log.info(`Loaded ${services.ctx.profiles.length} emulator profiles from ${config.profilesDir}`);
if (services.ctx.auth.setupRequired()) {
  app.log.warn('No admin password set yet: open the web GUI to create one, or set ROMSAFE_ADMIN_PASSWORD.');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
