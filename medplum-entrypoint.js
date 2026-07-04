// Generate medplum.config.json from environment variables, then start the server.
// The medplum-server Docker image is distroless (no shell), so this must be Node.js.
const fs = require('fs');
const { execFileSync } = require('child_process');

const config = {
  port: parseInt(process.env.MEDPLUM_PORT || '8103'),
  baseUrl: process.env.MEDPLUM_BASE_URL || 'http://localhost:8103/',
  appBaseUrl: process.env.MEDPLUM_APP_BASE_URL || 'http://localhost:3001/',
  storageBaseUrl: process.env.MEDPLUM_STORAGE_BASE_URL || '',
  allowedOrigins: process.env.MEDPLUM_ALLOWED_ORIGINS || '',
  database: {
    host: process.env.MEDPLUM_DATABASE_HOST || 'postgres',
    port: parseInt(process.env.MEDPLUM_DATABASE_PORT || '5432'),
    dbname: process.env.MEDPLUM_DATABASE_DBNAME || 'medplum',
    username: process.env.MEDPLUM_DATABASE_USERNAME || 'medplum',
    password: process.env.MEDPLUM_DATABASE_PASSWORD || '',
  },
  redis: {
    host: process.env.MEDPLUM_REDIS_HOST || 'redis',
    port: parseInt(process.env.MEDPLUM_REDIS_PORT || '6379'),
    password: process.env.MEDPLUM_REDIS_PASSWORD || '',
  },
  binaryStorage: process.env.MEDPLUM_BINARY_STORAGE || 'file:/usr/src/medplum/storage',
  registerEnabled: process.env.MEDPLUM_REGISTER_ENABLED === 'true',
  recaptchaSiteKey: '',
  vmContextBotsEnabled: process.env.MEDPLUM_VM_CONTEXT_BOTS_ENABLED === 'true',
  defaultFhirQuota: parseInt(process.env.MEDPLUM_DEFAULT_FHIR_QUOTA || '-1'),
  maxJsonSize: process.env.MEDPLUM_MAX_JSON_SIZE || '50mb',
  maxBatchSize: process.env.MEDPLUM_MAX_BATCH_SIZE || '50mb',
};

if (process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL) {
  config.defaultSuperAdminEmail = process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL;
}
if (process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD) {
  config.defaultSuperAdminPassword = process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD;
}

fs.writeFileSync('medplum.config.json', JSON.stringify(config, null, 2));
console.log('Generated medplum.config.json');
console.log('  baseUrl:', config.baseUrl);
console.log('  appBaseUrl:', config.appBaseUrl);
console.log('  superAdmin:', config.defaultSuperAdminEmail || '<not set>');

// Start the actual server process (ESM module, can't use require)
const { spawn } = require('child_process');
const server = spawn(
  process.execPath,
  ['--require', './packages/server/dist/otel/instrumentation.js', 'packages/server/dist/index.js'],
  { stdio: 'inherit' }
);
server.on('exit', (code) => process.exit(code || 0));
