import fs from 'fs';
import path from 'path';
import { Calculator, type CalculationOptions } from '../../fqm-execution/build/index.js';

const regressionBaseName = process.argv[2] ?? 'regression-output';
const verbose = process.argv[3] === 'true';
const singleMeasurePath = process.argv[4] ?? null;

const REGRESSION_OUTPUT_DIR = path.join(import.meta.dirname, `../output/${regressionBaseName}`);

const INPUT_BASE_PATH = path.join(import.meta.dirname, '../input');

const RESET = '\x1b[0m';
const FG_YELLOW = '\x1b[33m';
const FG_GREEN = '\x1b[32m';

/*
 * @public
 * @param {string} filesPath - patient file directory path
 * @param {string[]} testFilePaths - individual test files within that directory
 * @param {fhir4.Bundle} measureBundle - parsed measure bundle
 * @param {string} shortName - measure shortname for location of results
 */
async function calculateRegression(
  filesPath: string,
  testFilePaths: string[],
  measureBundle: fhir4.Bundle,
  containerName: string,
  shortName: string
) {
  const regressionResultsPath = path.join(REGRESSION_OUTPUT_DIR, containerName, shortName);
  console.log(`Path: ${regressionResultsPath}`);
  fs.mkdirSync(regressionResultsPath, { recursive: true });

  for (const tfp of testFilePaths) {
    const fullTestFilePath = path.join(filesPath, tfp);
    const patientBundle = JSON.parse(fs.readFileSync(fullTestFilePath, 'utf8')) as fhir4.Bundle;

    //turn tfp into un-nested path for results file
    const testResultsPath = path.join(regressionResultsPath, `results-${tfp.replace('/', '-')}`);

    try {
      const measure: fhir4.Measure = measureBundle.entry?.find(e => e.resource?.resourceType === 'Measure')
        ?.resource as fhir4.Measure;
      const options: CalculationOptions = {};
      // create the measurement period with full precision.
      if (measure.effectivePeriod?.start && measure.effectivePeriod?.end) {
        const startDate = new Date(measure.effectivePeriod.start);
        startDate.setUTCHours(0, 0, 0, 0);
        options.measurementPeriodStart = startDate.toISOString();
        const endDate = new Date(measure.effectivePeriod.end);
        endDate.setUTCHours(23, 59, 59, 999);
        options.measurementPeriodEnd = endDate.toISOString();
      }
      const { results } = await Calculator.calculate(measureBundle, [patientBundle], options);

      fs.writeFileSync(testResultsPath, JSON.stringify(results, undefined, verbose ? 2 : undefined), 'utf8');
      console.log(`${FG_GREEN}%s${RESET}: Results written to ${testResultsPath}`, 'SUCCESS');
    } catch (e) {
      if (e instanceof Error) {
        // Errors will not halt regression. For the purposes of these tests, what matters is that there aren't any new errors that weren't there before
        // or that the behavior related to the error differs from the base branch to the branch in question.
        // Errors that occur will be diffed just like normal calculation results
        fs.writeFileSync(
          testResultsPath,
          JSON.stringify({ error: e.message }, undefined, verbose ? 2 : undefined),
          'utf8'
        );
        console.log(`${FG_YELLOW}%s${RESET}: Results written to ${testResultsPath}`, 'EXECUTION ERROR');
      }
    }
  }
}

interface MeasureInfo {
  containerName: string;
  shortName: string;
  fullPath: string;
  testsPath: string;
}

function findMeasuresAndTestsInDirectory(
  containerName: string,
  containerPath: string,
  isCthonContent = false
): MeasureInfo[] {
  // check if this is a folder with a single measure
  const measurePath = fs
    .readdirSync(containerPath, { withFileTypes: true })
    .filter(f => path.extname(f.name) === '.json');
  if (measurePath.length === 1 && measurePath[0]) {
    const testsDirName = fs.readdirSync(path.resolve(containerPath)).find(f => f.endsWith('-tests'));
    if (testsDirName) {
      return [
        {
          containerName,
          shortName: path.basename(containerPath),
          fullPath: containerPath,
          testsPath: path.join(containerPath, testsDirName)
        }
      ];
    }
  }

  // Look for measures under this folder
  const subFolders = fs.readdirSync(containerPath, { withFileTypes: true }).filter(f => f.isDirectory());
  const measureInfo: MeasureInfo[] = [];
  for (const f of subFolders) {
    if (isCthonContent) {
      const testsDirPath = path.join(containerPath.replace('/bundles/', '/input/tests/'), f.name);

      if (testsDirPath && fs.existsSync(testsDirPath)) {
        measureInfo.push({
          containerName,
          shortName: f.name,
          fullPath: path.join(containerPath, f.name),
          testsPath: testsDirPath
        });
      }
    } else {
      const testsDirName = fs.readdirSync(path.join(containerPath, f.name)).find(f => f.endsWith('-tests'));
      if (testsDirName) {
        measureInfo.push({
          containerName,
          shortName: f.name,
          fullPath: path.join(containerPath, f.name),
          testsPath: path.join(containerPath, f.name, testsDirName)
        });
      }
    }
  }
  return measureInfo;
}

async function main() {
  if (fs.existsSync(REGRESSION_OUTPUT_DIR)) {
    fs.rmSync(REGRESSION_OUTPUT_DIR, { recursive: true });
  }

  fs.mkdirSync(REGRESSION_OUTPUT_DIR);
  let allDirs: MeasureInfo[] = [];
  // if a single measure or directory path was passed in we need to figure out what type is its
  if (singleMeasurePath) {
    // if it is a directory, look under it
    if (fs.statSync(path.resolve(singleMeasurePath)).isDirectory()) {
      const subFolders = fs.readdirSync(singleMeasurePath, { withFileTypes: true });
      if (subFolders.some(f => f.isDirectory() && f.name === 'bundles')) {
        allDirs.push(
          ...findMeasuresAndTestsInDirectory(
            path.basename(singleMeasurePath),
            path.join(singleMeasurePath, 'bundles', 'measure'),
            true
          )
        );
      } else if (subFolders.some(f => f.isDirectory() && f.name === 'fhir401')) {
        allDirs.push(
          ...findMeasuresAndTestsInDirectory(
            path.basename(singleMeasurePath),
            path.join(singleMeasurePath, 'fhir401', 'bundles', 'measure'),
            true
          )
        );
      } else {
        allDirs.push(
          ...findMeasuresAndTestsInDirectory(path.basename(singleMeasurePath), path.resolve(singleMeasurePath))
        );
      }
      // if it is a pointer at an exact measure file
    } else {
      const singleMeasureDirPath = path.dirname(singleMeasurePath);
      const testsDirName = fs.readdirSync(path.resolve(singleMeasureDirPath)).find(f => f.endsWith('-tests'));
      if (testsDirName) {
        allDirs.push({
          shortName: path.basename(singleMeasureDirPath),
          fullPath: path.resolve(singleMeasureDirPath),
          containerName: path.basename(singleMeasureDirPath),
          testsPath: path.join(singleMeasureDirPath, testsDirName)
        });
      }
    }
  } else {
    // find all of the measure directories, start with the container dirs
    const containerDirBasePaths = fs
      .readdirSync(INPUT_BASE_PATH, { withFileTypes: true })
      .filter(f => f.isDirectory())
      .map(f => path.join(INPUT_BASE_PATH, f.name));

    for (const containerDirBasePath of containerDirBasePaths) {
      const subFolders = fs.readdirSync(containerDirBasePath, { withFileTypes: true });
      // if this looks like a ecqm/dqm-content bundle repo by having a `bundles` directory
      if (subFolders.some(f => f.isDirectory() && f.name === 'bundles')) {
        allDirs.push(
          ...findMeasuresAndTestsInDirectory(
            path.basename(containerDirBasePath),
            path.join(containerDirBasePath, 'bundles', 'measure'),
            true
          )
        );
        // if this looks like the old connectathon repo with `fhir401` directory
      } else if (subFolders.some(f => f.isDirectory() && f.name === 'fhir401')) {
        allDirs.push(
          ...findMeasuresAndTestsInDirectory(
            path.basename(containerDirBasePath),
            path.join(containerDirBasePath, 'fhir401', 'bundles', 'measure'),
            true
          )
        );
        // standard folder/repo of folder for each measure with sub folder ending with `-tests` for the test cases
      } else {
        allDirs.push(...findMeasuresAndTestsInDirectory(path.basename(containerDirBasePath), containerDirBasePath));
      }
    }
  }

  for (const dir of allDirs) {
    const basePath = dir.fullPath;

    // It is assumed that the bundle lives under the base directory as the only json file
    const measureBundleFileName = fs.readdirSync(basePath).find(f => path.extname(f) == '.json');
    if (!measureBundleFileName) continue;

    const measureBundle = JSON.parse(
      fs.readFileSync(path.join(basePath, measureBundleFileName), 'utf8')
    ) as fhir4.Bundle;

    // Regression relies on test cases being in a folder that ends with `-tests`
    //const testsDirName = fs.readdirSync(basePath).find(f => f.endsWith('-tests'));
    // Skip measures with no `-tests` directory
    //if (!testsDirName) continue;
    //const testsDirPath = path.join(basePath, testsDirName);

    // Test cases can be directly in this folder or one level below
    const testFilePaths = fs.readdirSync(dir.testsPath, { withFileTypes: true }).flatMap((f): string[] => {
      // grab tests in the sub directory
      if (f.isDirectory()) {
        return fs
          .readdirSync(path.join(dir.testsPath, f.name))
          .filter(subF => path.extname(subF) === '.json')
          .map(subF => path.join(f.name, subF));
      } else if (path.extname(f.name) === '.json') {
        return [f.name];
      } else {
        return [];
      }
    });

    // Skip measures with no test patients in the `*-files` directory
    if (testFilePaths.length === 0) continue;

    await calculateRegression(dir.testsPath, testFilePaths, measureBundle, dir.containerName, dir.shortName);
  }
}

main().then(() => console.log('done'));
