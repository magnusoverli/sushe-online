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

async function inspectStateDirectory(root, cutoverId) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Deployment data must be a real directory');
  const directory = path.join(root, '.deployment');
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (!cutoverId && error.code === 'ENOENT') return directory;
    throw error;
  }
  if (
    rootStat.uid !== 0 ||
    rootStat.mode & 0o022 ||
    !stat.isDirectory() ||
    stat.uid !== 0 ||
    stat.mode & 0o077
  )
    throw new Error('Unsafe deployment state ownership or permissions');
  if (cutoverId) {
    const receipt = path.join(directory, '.sushe-tower19-complete');
    if (
      !/^\d+$/.test(cutoverId) ||
      !(await fs.lstat(receipt)).isFile() ||
      (await fs.readFile(receipt, 'utf8')).trimEnd() !== cutoverId
    )
      throw new Error('Expected matching PostgreSQL 19 application volume');
  }
  return directory;
}

async function loadState(env, beforePrepare) {
  if (process.getuid() !== 0)
    throw new Error(
      'The published Compose upgrade requires the image entrypoint identity'
    );
  const root = env.DATA_DIR || '/app/data';
  const directory = await inspectStateDirectory(
    root,
    env.SUSHE_PG19_CUTOVER_ID
  );
  const file = path.join(directory, 'state.json');
  let state;
  let fresh = false;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.uid !== 0 || stat.mode & 0o077)
      throw new Error('Unsafe deployment state file');
    state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.version !== 1 || !state.env || !state.candidate)
      throw new Error('Unrecognized deployment state');
  } catch (error) {
    if (env.SUSHE_PG19_CUTOVER_ID || error.code !== 'ENOENT') throw error;
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
    fresh = true;
  }
  // Even an accidental image pull on PG18 must leave both volumes usable
  // with the previous app, including the original file ownership.
  if (beforePrepare) await beforePrepare(state.env.PROVISION_DATABASE_URL);
  if (!env.SUSHE_PG19_CUTOVER_ID) {
    await fs.chown(root, 0, 0);
    await fs.chmod(root, 0o755);
    if (fresh) {
      await fs.mkdir(directory, { mode: 0o700, recursive: true });
      await inspectStateDirectory(root);
    }
  }
  if (fresh) await saveState(directory, state);
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
