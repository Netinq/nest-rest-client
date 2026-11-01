const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectDirectory = path.resolve(__dirname, '../..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-rest-client-smoke-'));
const consumerPath = path.join(__dirname, 'consumer.cjs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectDirectory,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: options.silent ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.silent) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

function npm(args, options) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Run the smoke tests through "npm run test:smoke" so npm can be located reliably.');
  }
  return run(process.execPath, [npmCli, ...args], options);
}

function installScenario(name, dependencies, withResilience = false) {
  const scenarioDirectory = path.join(temporaryDirectory, name);
  fs.mkdirSync(scenarioDirectory);
  fs.copyFileSync(consumerPath, path.join(scenarioDirectory, 'consumer.cjs'));
  fs.writeFileSync(path.join(scenarioDirectory, 'package.json'), JSON.stringify({private: true}));

  console.log(`\nSmoke test: ${name}`);
  npm([
    'install',
    '--no-audit',
    '--no-fund',
    '--no-progress',
    '--ignore-scripts',
    '--no-save',
    ...dependencies,
  ], {cwd: scenarioDirectory, silent: true});

  run(process.execPath, ['consumer.cjs'], {
    cwd: scenarioDirectory,
    silent: false,
    env: {
      ...process.env,
      SMOKE_WITH_RESILIENCE: withResilience ? '1' : '0',
    },
  });
}

try {
  const packedDirectory = path.join(temporaryDirectory, 'packed');
  fs.mkdirSync(packedDirectory);
  const packResult = npm(['pack', '--json', '--pack-destination', packedDirectory], {
    silent: true,
  });
  const [{filename}] = JSON.parse(packResult.stdout);
  const packageTarball = path.join(packedDirectory, filename);

  const minimumPeerDependencies = [
    `@sarqdev/nest-rest-client@${packageTarball}`,
    '@nestjs/common@11.1.5',
    '@nestjs/core@11.1.5',
    'axios@1.11.0',
    'class-transformer@0.5.1',
  ];
  const latestNest11Dependencies = [
    `@sarqdev/nest-rest-client@${packageTarball}`,
    '@nestjs/common@^11.1.5',
    '@nestjs/core@^11.1.5',
    'axios@^1.11.0',
    'class-transformer@^0.5.1',
  ];
  const minimumNest12Dependencies = [
    `@sarqdev/nest-rest-client@${packageTarball}`,
    '@nestjs/common@12.0.0',
    '@nestjs/core@12.0.1',
    'axios@1.11.0',
    'class-transformer@0.5.1',
  ];
  const latestNest12Dependencies = [
    `@sarqdev/nest-rest-client@${packageTarball}`,
    '@nestjs/common@^12.0.0',
    '@nestjs/core@^12.0.1',
    'axios@^1.11.0',
    'class-transformer@^0.5.1',
  ];

  installScenario('minimum-nest-11-and-peer-dependencies', minimumPeerDependencies);
  installScenario('latest-nest-11-and-peer-dependencies', latestNest11Dependencies);
  installScenario('minimum-nest-12-and-peer-dependencies', minimumNest12Dependencies);
  installScenario('latest-nest-12-and-peer-dependencies', latestNest12Dependencies);
  installScenario('latest-nest-12-with-optional-resilience', [
    ...latestNest12Dependencies,
    '@nestjs/resilience@^0.0.3',
  ], true);

  console.log('\nAll peer dependency smoke tests passed.');
} finally {
  fs.rmSync(temporaryDirectory, {recursive: true, force: true});
}
