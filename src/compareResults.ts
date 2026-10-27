import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import type { DetailedPopulationGroupResult, ExecutionResult } from '../../fqm-execution/build/types/Calculator.js';

const beforeDir = process.argv[2];
const afterDir = process.argv[3];

const RESET = '\x1b[0m';
const FG_RED = '\x1b[31m';

if (!beforeDir || !afterDir) {
  console.error('need two folders as params');
  process.exit(1);
}

console.log(`Comparing ${beforeDir} and ${afterDir}`);

let fileCount = 0;
let diffCount = 0;

if (fs.existsSync(path.join('output', 'compare-output'))) {
  fs.rmSync(path.join('output', 'compare-output'), { recursive: true });
}
fs.mkdirSync(path.join('output', 'compare-output', 'before'), { recursive: true });
fs.mkdirSync(path.join('output', 'compare-output', 'after'), { recursive: true });

fs.readdirSync(beforeDir, { withFileTypes: true }).forEach(ent => {
  // if this item is a directory, look for .json files under it
  if (ent.isDirectory()) {
    fs.readdirSync(path.join(beforeDir, ent.name), { withFileTypes: true }).forEach(subEnt => {
      if (!subEnt.isDirectory() && subEnt.name.endsWith('.json')) {
        if (fs.existsSync(path.join(afterDir, ent.name, subEnt.name))) {
          fileCount++;
          const beforeFile = path.join(beforeDir, ent.name, subEnt.name);
          const afterFile = path.join(afterDir, ent.name, subEnt.name);
          const compResult = compareResultsFiles(beforeFile, afterFile);
          if (!compResult) {
            console.warn(`${FG_RED}DIFF${RESET}: ${beforeFile}   AND   ${afterFile}`);
            diffCount++;
          }
        } else {
          console.warn(`${path.join(ent.name, subEnt.name)} was not found in ${afterDir}`);
        }
      }
    });
  }
});

console.log(`\n\n Total Files: ${fileCount}\n  Diff Files: ${diffCount}`);
console.log('Files with diffs after irrelevant data removal can be found at output/compare-output');

function wipeIrrelevantData(results: any) {
  if (Array.isArray(results)) {
    if (results[0]) {
      const patientResult = results[0] as ExecutionResult<DetailedPopulationGroupResult>;
      if (patientResult.detailedResults) {
        for (const detailedResult of patientResult.detailedResults) {
          //wipe out clause results and html
          detailedResult.statementResults = [];
          detailedResult.clauseResults = [];
          detailedResult.html = '';
          // TODO: wipe out any occurrences in the detailedResult.episodeResults.stratifierResults.rawResult and detailedResult structure that has a key of `pointType`
        }

        // TODO: wipe out any occurences in the patientResult.supplementalData structure
        removePointType(patientResult);
      }
      // uniqueify evaluatedResources
      if (patientResult.evaluatedResource) {
        patientResult.evaluatedResource = _.uniqBy(patientResult.evaluatedResource, r => `${r.resourceType}: ${r.id}`);
        patientResult.evaluatedResource = _.sortBy(patientResult.evaluatedResource, r => `${r.resourceType}: ${r.id}`);
      }
    }
    return true;
  } else {
    return false;
  }
}

function removePointType(obj: any) {
  if (obj === null || typeof obj !== 'object') return;

  if (
    ['low', 'high', 'lowClosed', 'highClosed', 'pointType'].every(key => Object.prototype.hasOwnProperty.call(obj, key))
  ) {
    delete obj.pointType;
  }

  for (const value of Object.values(obj)) {
    removePointType(value);
  }
}

function compareResultsFiles(beforeFile: string, afterFile: string) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));

  if (!wipeIrrelevantData(before)) {
    //console.warn(`Failed to wipe irrelevant data from: ${beforeFile}`);
  }

  if (!wipeIrrelevantData(after)) {
    //console.warn(`Failed to wipe irrelevant data from: ${afterFile}`);
  }

  const beforeString = JSON.stringify(before);
  const afterString = JSON.stringify(after);

  if (beforeString == afterString) {
    return true;
  } else {
    fs.writeFileSync(
      path.join('output', 'compare-output', 'before', path.basename(beforeFile)),
      JSON.stringify(before, null, 2)
    );
    fs.writeFileSync(
      path.join('output', 'compare-output', 'after', path.basename(afterFile)),
      JSON.stringify(after, null, 2)
    );
    return false;
  }
}
