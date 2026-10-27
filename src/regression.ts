import fs from 'fs';
import path from 'path';
import { Calculator } from '../../fqm-execution/build/index.js';

const regressionBaseName = process.argv[2] ?? 'regression-output';
const verbose = process.argv[3] === 'true';
const singleMeasurePath = process.argv[4] ?? null;

const REGRESSION_OUTPUT_DIR = path.join(import.meta.dirname, `../output/${regressionBaseName}`);

const INPUT_BASE_PATH = path.join(import.meta.dirname, '../input');

const RESET = '\x1b[0m';
const FG_YELLOW = '\x1b[33m';
const FG_GREEN = '\x1b[32m';

function findPatientBundlePathsInDirectory(patientDir: string): string[] {
  const paths: string[] = [];
  // iterate over the given directory
  fs.readdirSync(patientDir, { withFileTypes: true }).forEach(ent => {
    // if this item is a directory, look for .json files under it
    if (ent.isDirectory()) {
      fs.readdirSync(path.join(patientDir, ent.name), { withFileTypes: true }).forEach(subEnt => {
        if (!subEnt.isDirectory() && subEnt.name.endsWith('.json')) {
          paths.push(path.join(ent.name, subEnt.name));
        }
      });
    } else if (ent.name.endsWith('.json')) {
      paths.push(ent.name);
    }
  });
  return paths;
}

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
  shortName: string
) {
  const regressionResultsPath = path.join(REGRESSION_OUTPUT_DIR, shortName);
  console.log(`Path: ${regressionResultsPath}`);
  fs.mkdirSync(regressionResultsPath);

  for (const tfp of testFilePaths) {
    const fullTestFilePath = path.join(filesPath, tfp);
    const patientBundle = JSON.parse(fs.readFileSync(fullTestFilePath, 'utf8')) as fhir4.Bundle;

    //turn tfp into un-nested path for results file
    const testResultsPath = path.join(regressionResultsPath, `results-${tfp.replace('/', '-')}`);

    try {
      const { results } = await Calculator.calculate(measureBundle, [patientBundle], {});

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

async function main() {
  if (fs.existsSync(REGRESSION_OUTPUT_DIR)) {
    fs.rmSync(REGRESSION_OUTPUT_DIR, { recursive: true });
  }

  fs.mkdirSync(REGRESSION_OUTPUT_DIR);
  let allDirs:{shortName: string, fullPath: string}[] = [];
  // if a single measure was passed in, either the path to it or the bundle
  if (singleMeasurePath) {
    if (fs.statSync(path.resolve(singleMeasurePath)).isDirectory()){
      allDirs.push({ shortName: path.basename(singleMeasurePath), fullPath: path.resolve(singleMeasurePath)});
    } else {
      const singleMeasureDirPath = path.dirname(singleMeasurePath);
      allDirs.push({ shortName: path.basename(singleMeasureDirPath), fullPath: path.resolve(singleMeasureDirPath)});
    }
  } else {
    // find all of the measure directories
    const measureDirBasePaths = fs.readdirSync(INPUT_BASE_PATH, { withFileTypes: true })
      .filter(f => f.isDirectory())
      .map(f => path.join(INPUT_BASE_PATH, f.name));

    allDirs = measureDirBasePaths
      .map(d =>
        fs.readdirSync(d).map(f => ({
          shortName: f,
          fullPath: path.join(d, f)
        }))
      )
      .flat();
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
    const testsDirName = fs.readdirSync(basePath).find(f => f.endsWith('-tests'));
    // Skip measures with no `-tests` directory
    if (!testsDirName) continue;
    const testsDirPath = path.join(basePath, testsDirName);
    
    // Test cases can be directly in this folder or one level below
    const testFilePaths = fs.readdirSync(testsDirPath, { withFileTypes: true })
      .flatMap((f): string[] => {
        // grab tests in the sub directory
        if (f.isDirectory()) {
          return fs.readdirSync(path.join(testsDirPath, f.name))
            .filter(subF => path.extname(subF) === '.json')
            .map(subF => path.join(f.name, subF))
        } else if (path.extname(f.name) === '.json') {
          return [f.name];
        } else {
          return [];
        }
      });

    // Skip measures with no test patients in the `*-files` directory
    if (testFilePaths.length === 0) continue;
    
    await calculateRegression(testsDirPath, testFilePaths, measureBundle, dir.shortName);
  }
}

main().then(() => console.log('done'));
