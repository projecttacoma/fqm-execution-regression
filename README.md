# fqm-execution-regression
Scripts for running regression tests on fqm-execution.

## Setting up

Clone this repo in the folder next to `fqm-execution`.

`npm install`

Check out measure test repository in `input` folder. Or add folders with measures and test cases with the structure similar to below:

```
-- input/
 |-- simple-measures/
 | |-- CMS111/
 | | |-- CMS111-v1212.json
 | | |-- CMS111-tests/
 | |   |-- test-1.json
 | |   |-- test-2.json
 | |-- CMS123/
 |   |-- CMS123-v1212.json
 |   |-- CMS123-tests/
 |     |-- test-123/
 |     | |-- test-123.json
 |     |-- test-124/
 |       |-- test-124.json
 |-- measure-repo/
   |-- CMS549/
     |-- measure-bundle.json
     |-- measure-tests/
       |-- test-2.json
       |-- test-ab.json
       |-- test-123.json
```

Note that the only naming convention is that the folder containing the tests must end in `-tests`. The test cases may be in individual folders under that folder.

## Running

`./run-regression.sh`