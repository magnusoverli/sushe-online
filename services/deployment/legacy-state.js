const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { databaseConfig } = require('../../config/database-connection');
const { resolveSessionSettings } = require('../../config/session');

const secret = () => randomBytes(32).toString('hex');

function sessionSecretFor(env, previous) {
  try {
    return resolveSessionSettings(env, { error() {} }).sessionSecret;
  } catch {
    return previous || secret();
  }
}

function isLegacyDeployment(env, args) {
  if (
    env.NODE_ENV !== 'production' ||
    env.CONTROL_DATABASE_URL ||
    (env.DATA_DIR || '/app/data') !== '/app/data' ||
    args.join(' ') !== 'node index.js'
  )
    return false;
  const db = databaseConfig(env.DATABASE_URL);
  return (
    db.user === 'postgres' &&
    db.database === 'sushe' &&
    db.host === '/var/run/postgresql'
  );
}

function socketUrl(user, password, database) {
  const url = new URL(`postgres://localhost/${database}`);
  url.username = user;
  url.password = password;
  url.searchParams.set('host', '/var/run/postgresql');
  return url.toString();
}

async function saveState(directory, state) {
  const tmp = path.join(
    directory,
    `state-${randomBytes(8).toString('hex')}.tmp`
  );
  const file = await fs.open(tmp, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(state));
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.rename(tmp, path.join(directory, 'state.json'));
  const parent = await fs.open(directory, 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

async function moveWithoutOverwrite(source, destination) {
  try {
    await fs.lstat(destination);
    throw new Error(
      'Application data relocation would overwrite an existing file'
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(source, destination);
}

async function loadState(env) {
  if (process.getuid() !== 0)
    throw new Error(
      'The published Compose upgrade requires the image entrypoint identity'
    );
  const root = env.DATA_DIR || '/app/data';
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Deployment data must be a real directory');
  await fs.chown(root, 0, 0);
  await fs.chmod(root, 0o755);
  const directory = path.join(root, '.deployment');
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.uid !== 0 || stat.mode & 0o077)
    throw new Error('Unsafe deployment state ownership or permissions');
  const file = path.join(directory, 'state.json');
  let state;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.uid !== 0 || stat.mode & 0o077)
      throw new Error('Unsafe deployment state file');
    state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.version !== 1 || !state.env || !state.candidate)
      throw new Error('Unrecognized deployment state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const id = randomBytes(6).toString('hex');
    const candidate = `sushe_upgrade_${id}`;
    const control = `sushe_control_${id}`;
    state = {
      version: 1,
      candidate,
      original: 'sushe',
      control,
      createdAt: new Date().toISOString(),
      env: {
        DATABASE_URL: socketUrl(`sushe_app_${id}`, secret(), candidate),
        MIGRATION_DATABASE_URL: socketUrl(
          `sushe_owner_${id}`,
          secret(),
          candidate
        ),
        BACKUP_DATABASE_URL: socketUrl(
          `sushe_backup_${id}`,
          secret(),
          candidate
        ),
        RECOVERY_DATABASE_URL: socketUrl(
          `sushe_recovery_${id}`,
          secret(),
          control
        ),
        CONTROL_DATABASE_URL: socketUrl(
          `sushe_control_${id}`,
          secret(),
          control
        ),
        PROVISION_DATABASE_URL: socketUrl('postgres', secret(), 'postgres'),
        RECOVERY_TEMPLATE_DATABASE: `sushe_template_${id}`,
        SESSION_SECRET: sessionSecretFor(env),
      },
    };
    await saveState(directory, state);
  }
  const sessionSecret = sessionSecretFor(env, state.env.SESSION_SECRET);
  if (sessionSecret !== state.env.SESSION_SECRET) {
    state.env.SESSION_SECRET = sessionSecret;
    await saveState(directory, state);
  }
  const appData = path.join(root, 'application');
  await fs.mkdir(appData, { recursive: true, mode: 0o700 });
  if (!(await fs.lstat(appData)).isDirectory())
    throw new Error('Unsafe application data directory');
  await fs.chown(appData, 1000, 1000);
  // Existing files stay on the original volume, under the unprivileged data root.
  for (const name of await fs.readdir(root)) {
    if (
      name === '.deployment' ||
      name === 'application' ||
      name === 'recovery-uploads'
    )
      continue;
    await moveWithoutOverwrite(path.join(root, name), path.join(appData, name));
  }
  const uploads = path.join(root, 'recovery-uploads');
  await fs.mkdir(uploads, { recursive: true, mode: 0o770 });
  if (!(await fs.lstat(uploads)).isDirectory())
    throw new Error('Unsafe upload directory');
  await fs.chown(uploads, 0, 1000);
  await fs.chmod(uploads, 0o2770);
  return { state, directory, root, appData, uploads };
}

module.exports = {
  isLegacyDeployment,
  socketUrl,
  loadState,
  saveState,
  sessionSecretFor,
};
