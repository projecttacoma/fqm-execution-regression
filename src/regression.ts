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
 * @param {string[]} testFilePaths - paths to individual test files to run
 * @param {fhir4.Bundle} measureBundle - parsed measure bundle
 * @param {string} containerName - name of the container/repo used for location of results
 * @param {string} shortName - measure shortname for location of results
 */
async function calculateRegression(
  testFilePaths: string[],
  measureBundle: fhir4.Bundle,
  containerName: string,
  shortName: string
) {
  const regressionResultsPath = path.join(REGRESSION_OUTPUT_DIR, containerName, shortName);
  console.log(`Path: ${regressionResultsPath}`);
  fs.mkdirSync(regressionResultsPath, { recursive: true });

  for (const testFilePath of testFilePaths) {
    const patientBundle = JSON.parse(fs.readFileSync(testFilePath, 'utf8')) as fhir4.Bundle;

    //turn tfp into un-nested path for results file
    const testResultsPath = path.join(regressionResultsPath, `results-${path.basename(testFilePath)}`);

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

/** Interface for describing how to find measures and test cases in a known repo */
interface RepoInfo {
  /** Name of repo */
  name: string;
  /** Relative path to where the measure directories are */
  measuresPath: string;
  /** Relative path to the tests from the measure directory. Use %s to have it replaced by the name of the measure (the measure directory) */
  testsPath: string;
  /** If the test cases are in a subdirectory, what is the suffix of the directory name that should be searched for */
  testsPathSuffix?: string;
  /** If the test cases are mixed with other data what is the prefix of the test files */
  testsPrefix?: string;
  /** If each test case is allowed to be contained in its own folder */
  allowTestCaseFolders: boolean;
}

/** Info for all of the known repos and how to find them */
const REPO_INFO: Record<string, RepoInfo> = {
  connectathon: {
    name: 'connectathon',
    measuresPath: 'fhir401/bundles/measure',
    testsPath: '.',
    testsPathSuffix: '-files',
    testsPrefix: 'tests-',
    allowTestCaseFolders: false
  },
  'ecqm-content-qicore-2022': {
    name: 'ecqm-content-qicore-2022',
    measuresPath: 'bundles/measure',
    testsPath: '../../../input/tests/measure/%s',
    testsPrefix: 'tests-',
    allowTestCaseFolders: false
  },
  'ecqm-content-r4-2021': {
    name: 'ecqm-content-r4-2021',
    measuresPath: 'bundles/measure',
    testsPath: '.',
    testsPathSuffix: '-files',
    testsPrefix: 'tests-',
    allowTestCaseFolders: false
  }
};

/** The default settings to use for an unknown repo/folder */
const DEFAULT_REPO_INFO: RepoInfo = {
  name: 'default',
  measuresPath: '.',
  testsPath: '.',
  testsPathSuffix: '-tests',
  allowTestCaseFolders: true
};

/** Interface for holding information about where to find a measure bundle and the test cases that should be run for it */
interface MeasureInfo {
  /** The repo/folder this was found in */
  containerName: string;
  /** The short name for the measure found from the measure's folder */
  shortName: string;
  /** The full path to the measure bundle */
  fullPath: string;
  /** List of full paths to all tests cases */
  testFilePaths: string[];
}

function findMeasuresAndTestsInDirectory(
  containerName: string,
  containerPath: string,
  isSingleMeasure = false
): MeasureInfo[] {
  const measureInfo: MeasureInfo[] = [];
  const repoInfo = REPO_INFO[containerName] ?? DEFAULT_REPO_INFO;

  // Look for measures
  let measuresDirPath = path.resolve(path.join(containerPath, repoInfo.measuresPath));
  let subFolders = fs.readdirSync(measuresDirPath, { withFileTypes: true }).filter(f => f.isDirectory());

  // single measure situation, replace the information set above to only have the single measure
  if (isSingleMeasure) {
    measuresDirPath = path.resolve(path.dirname(containerPath));
    subFolders = fs
      .readdirSync(measuresDirPath, { withFileTypes: true })
      .filter(f => f.isDirectory() && f.name === path.basename(containerPath));
  }

  for (const f of subFolders) {
    // find the measure bundle
    const measureBundleFileName = fs
      .readdirSync(path.join(measuresDirPath, f.name))
      .find(mf => path.extname(mf) == '.json');
    if (!measureBundleFileName) continue;

    // determine where to look for test cases using this measure folder name as replacement if that is needed in this repo
    const relativeTestsPath = repoInfo.testsPath.includes('%s')
      ? repoInfo.testsPath.replace('%s', f.name)
      : repoInfo.testsPath;
    let testCasesPath = path.resolve(path.join(measuresDirPath, f.name), relativeTestsPath);

    // if the test cases may in a sub folder with a suffix
    if (repoInfo.testsPathSuffix !== undefined) {
      let subTestCasesPath = fs
        .readdirSync(testCasesPath, { withFileTypes: true })
        .find(tsd => tsd.isDirectory() && tsd.name.endsWith(repoInfo.testsPathSuffix as string))?.name;
      if (!subTestCasesPath) continue;
      testCasesPath = path.join(testCasesPath, subTestCasesPath);
    }

    // get list of test cases
    const testFilePaths = fs.readdirSync(testCasesPath, { withFileTypes: true }).flatMap((f): string[] => {
      // grab tests in the sub directory
      if (f.isDirectory() && repoInfo.allowTestCaseFolders) {
        return fs
          .readdirSync(path.join(testCasesPath, f.name))
          .filter(subF => path.extname(subF) === '.json')
          .map(subF => path.join(testCasesPath, f.name, subF));
      } else if (path.extname(f.name) === '.json') {
        if (repoInfo.testsPrefix === undefined || f.name.startsWith(repoInfo.testsPrefix)) {
          return [path.join(testCasesPath, f.name)];
        }
      }
      return [];
    });

    measureInfo.push({
      containerName,
      shortName: f.name,
      fullPath: path.join(measuresDirPath, f.name, measureBundleFileName),
      testFilePaths: testFilePaths
    });
  }

  return measureInfo;
}

async function main() {
  if (fs.existsSync(REGRESSION_OUTPUT_DIR)) {
    fs.rmSync(REGRESSION_OUTPUT_DIR, { recursive: true });
  }

  fs.mkdirSync(REGRESSION_OUTPUT_DIR);
  let measureInfo: MeasureInfo[] = [];
  // if a single measure or directory path was passed in we need to figure out what type is its
  if (singleMeasurePath) {
    // if it is a directory, look under it
    if (fs.statSync(path.resolve(singleMeasurePath)).isDirectory()) {
      // if this has a json file assume it is a single measure folder
      const dirents = fs.readdirSync(singleMeasurePath, { withFileTypes: true });
      if (dirents.some(f => f.isFile() && path.extname(f.name) === '.json')) {
        measureInfo.push(
          ...findMeasuresAndTestsInDirectory(
            path.basename(path.dirname(singleMeasurePath)),
            path.resolve(singleMeasurePath),
            true
          )
        );
      } else {
        // if theres no json file this could be pointed at a single repo
        measureInfo.push(
          ...findMeasuresAndTestsInDirectory(path.basename(singleMeasurePath), path.resolve(singleMeasurePath))
        );
      }
      // if it is a pointer at an exact measure file
    } else {
      measureInfo.push(
        ...findMeasuresAndTestsInDirectory(
          path.basename(path.dirname(path.dirname(singleMeasurePath))),
          path.resolve(path.dirname(singleMeasurePath)),
          true
        )
      );
    }
  } else {
    // find all of the measure directories, start with the container/repo dirs
    const containerDirBasePaths = fs
      .readdirSync(INPUT_BASE_PATH, { withFileTypes: true })
      .filter(f => f.isDirectory())
      .map(f => path.join(INPUT_BASE_PATH, f.name));

    for (const containerDirBasePath of containerDirBasePaths) {
      measureInfo.push(...findMeasuresAndTestsInDirectory(path.basename(containerDirBasePath), containerDirBasePath));
    }
  }

  // write out the measureInfo to the regression folder
  fs.writeFileSync(path.join(REGRESSION_OUTPUT_DIR, 'measureInfo.json'), JSON.stringify(measureInfo, undefined, 2));

  for (const measure of measureInfo) {
    const measureBundle = JSON.parse(fs.readFileSync(measure.fullPath, 'utf8')) as fhir4.Bundle;

    // Skip measures with no test patients
    if (measure.testFilePaths.length === 0) continue;

    await calculateRegression(measure.testFilePaths, measureBundle, measure.containerName, measure.shortName);
  }
}

main().then(() => console.log('done'));
