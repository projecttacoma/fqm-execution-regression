#!/bin/bash

FQM_DIR=../fqm-execution
REGRESSION_REPO_DIR=$(pwd)
npm run build
echo "stored regression location $REGRESSION_REPO_DIR"

cd $FQM_DIR
if [ ! -z "$(git status --untracked-files=no --porcelain)" ]; then 
  echo "Changes detected in working directory. Either stash or commit them before running regression"
  exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

VERBOSE=false
BASE_BRANCH="master"

function usage() {
    cat <<USAGE

    Usage: $0 [-b|--base-branch <branch-name>] [-v|--verbose] [-m|--measure <path to measure>]

    Options:
        -b/--base-branch:   Base branch to compare results with (default: master)
        -v/--verbose:       Use verbose regression. Will print out diffs of failing JSON files with spacing (default: false)
        -m/--measure:       Use a measure in a specific folder with it's test cases in a subfolder
USAGE
    exit 1
}

while test $# != 0
do
    case "$1" in
    -v | --verbose) VERBOSE=true ;;
    -b | --base-branch)
      shift
      BASE_BRANCH=$1
      ;;
    -m | --measure) 
      shift
      MEASURE_PATH=$1
      ;;
    *)  usage ;;
    esac
    shift
done

git fetch --all

CURRENT_BRANCH=$(git symbolic-ref --short -q HEAD)

if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  echo "Cannot run regression while on the base branch, ensure current branch is different from base"
  exit 1
fi

TIMESTAMP=$(date +%s)

echo "Gathering results on current branch '$CURRENT_BRANCH'"

cd $FQM_DIR
npm i

cd $REGRESSION_REPO_DIR
node ./build/regression.js "$CURRENT_BRANCH-$TIMESTAMP" $VERBOSE $MEASURE_PATH

echo "Gathering results on base branch '$BASE_BRANCH'"

cd $FQM_DIR
git checkout $BASE_BRANCH
npm i

cd $REGRESSION_REPO_DIR
node ./build/regression.js  "$BASE_BRANCH-$TIMESTAMP" $VERBOSE $MEASURE_PATH

FAILURES=()
BASE_BRANCH_BASE_PATH="output/$BASE_BRANCH-$TIMESTAMP"
CURRENT_BRANCH_BASE_PATH="output/$CURRENT_BRANCH-$TIMESTAMP"
for fname in $CURRENT_BRANCH_BASE_PATH/**/*.json; do
  # Gets the name of the test file itself ignoring the base path
  END_PATH=${fname#*/*/}
  P1="$CURRENT_BRANCH_BASE_PATH/$END_PATH"
  P2="$BASE_BRANCH_BASE_PATH/$END_PATH"

  if ! test -f "$P1"; then
    echo -e "${RED}FAIL${NC}: $P1 does not exist"
    FAILURES+=("$P1")
  fi

  if ! test -f "$P2"; then
    echo -e "${RED}FAIL${NC}: $P2 does not exist"
    FAILURES+=("$P2")
  fi

  if cmp --silent $P1 $P2 ; then
    echo -e "${GREEN}PASS${NC}: $END_PATH"
  else
    echo -e "${RED}FAIL${NC}: $P1 and $P2 are different"
    FAILURES+=("$END_PATH")

    if [ $VERBOSE = "true" ]; then
      diff $P1 $P2
    fi
  fi
done

if [ ${#FAILURES[@]} -gt 0 ]; then
  printf "\n\nSummary of All Failures:\n\n"

  for s in "${FAILURES[@]}"; do
    echo -e "${RED}FAIL${NC}: $s"
  done

  printf "\n\n"
  cd $FQM_DIR
  git checkout $CURRENT_BRANCH
  cd $REGRESSION_REPO_DIR
  printf "\n\nRunning compare script dropping irrelevant changes.\n"
  node build/compareResults.js $BASE_BRANCH_BASE_PATH $CURRENT_BRANCH_BASE_PATH
  exit 1
else
  printf "\n\nRegression Passed\n\n"
  cd $FQM_DIR
  git checkout $CURRENT_BRANCH
fi

