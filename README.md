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

# License

Copyright 2026 The MITRE Corporation

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0).


Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
