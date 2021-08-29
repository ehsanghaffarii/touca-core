// Copyright 2021 Touca, Inc. Subject to Apache-2.0 License.

/**
 * @file runner
 *
 * Touca Test Framework for JavaScript is designed to make writing regression
 * test workflows easy and straightforward. The test framework abstracts away
 * many of the common expected features such as logging, error handling and
 * progress reporting.
 *
 * The following example demonstrates how to use this framework:
 *
 * ```js
 *  import { touca } from '@touca/node';
 *  import { parse_profile, calculate_gpa } from  './code_under_test';
 *
 *  touca.workflow('test_students', (testcase: string) => {
 *    const student = parse_profile(testcase);
 *    touca.add_assertion('username', student.username);
 *    touca.add_result('fullname', student.fullname);
 *    touca.add_result('birth_date', student.dob);
 *    touca.add_result('gpa', calculate_gpa(student.courses));
 *  });
 *
 *  touca.run();
 * ```
 * It is uncommon to run multiple regression test workflows as part of a
 * single suite. However, the pattern above allows introducing multiple
 * workflows using the {@link touca.workflow} function.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { NodeClient } from './client';
import { NodeOptions, update_options } from './options';
import { VERSION } from './version';

interface RunnerOptions extends NodeOptions {
  overwrite: boolean;
  save_json: boolean;
  save_binary: boolean;
  testcases: string[];
  testcase_file: string;
  output_directory: string;
  // log_level: 'debug' | 'info' | 'warn';
}

/**
 *
 */
enum ToucaErrorCode {
  MissingWorkflow = 1,
  MissingSlugs,
  NoCaseMissingFile,
  NoCaseMissingRemote,
  NoCaseEmptyRemote
}

/**
 *
 */
class ToucaError {
  private _message = '';
  private _errors = new Map<ToucaErrorCode, string>([
    [
      ToucaErrorCode.MissingWorkflow,
      `
      No workflow is registered.
      `
    ],
    [
      ToucaErrorCode.MissingSlugs,
      `
      Options %s are required when using this test framework.
      `
    ],
    [
      ToucaErrorCode.NoCaseMissingFile,
      `
      Specified testcase file "%s" does not exist.
      `
    ],
    [
      ToucaErrorCode.NoCaseMissingRemote,
      `
      Cannot proceed without a test case.
      Either use '--testcase' or '--testcase-file' to pass test cases
      or use '--api-key' and '--api-url' to let the library query
      the Touca Server to obtain and reuse the list of test cases
      submitted to the baseline version of this suite.
      `
    ],
    [
      ToucaErrorCode.NoCaseEmptyRemote,
      `
      Cannot proceed without a test case.
      Neither '--testcase' nor '--testcase-file' were provided.
      Attempted to query the Touca Server to obtain and reuse the
      list of test cases submitted to the baseline version of this
      suite but this suite has no previous version.
      `
    ]
  ]);

  /**
   *
   */
  constructor(code: ToucaErrorCode, args: string[] = []) {
    this._message = this._errors.has(code)
      ? util.format(this._errors.get(code), ...args)
      : 'Unknown Error';
  }

  /**
   *
   */
  public get message(): string {
    return this._message;
  }
}

/**
 *
 */
class Statistics {
  private _values: Record<string, number> = {};

  public inc(name: string): void {
    if (!(name in this._values)) {
      this._values[name] = 0;
    }
    this._values[name] += 1;
  }

  public count(name: string) {
    return this._values[name] ?? 0;
  }
}

/**
 *
 */
class Timer {
  private _tics: Record<string, number> = {};
  private _times: Record<string, number> = {};

  public tic(name: string): void {
    this._tics[name] = new Date().getTime();
  }

  public toc(name: string): void {
    this._times[name] = new Date().getTime() - this._tics[name];
  }

  public count(name: string) {
    return this._times[name];
  }
}

/**
 *
 */
function _parse_cli_options(args: string[]): RunnerOptions {
  const argv = yargs(hideBin(args))
    .version(VERSION)
    .epilog('Visit https://docs.touca.io for more information')
    .options({
      'api-key': {
        type: 'string',
        desc: 'API Key issued by the Touca Server'
      },
      'api-url': {
        type: 'string',
        desc: 'API URL issued by the Touca Server'
      },
      revision: {
        type: 'string',
        desc: 'Version of the code under test'
      },
      suite: {
        type: 'string',
        desc: 'Slug of suite to which test results belong'
      },
      team: {
        type: 'string',
        desc: 'Slug of team to which test results belong'
      },
      'config-file': {
        type: 'string',
        desc: 'Path to a configuration file'
      },
      testcase: {
        type: 'array',
        desc: 'Single testcase to feed to the workflow',
        conflicts: 'testcase-file'
      },
      'testcase-file': {
        type: 'string',
        desc: 'Single file listing testcases to feed to the workflows',
        conflicts: 'testcase'
      },
      'save-as-binary': {
        type: 'boolean',
        desc: 'Save a copy of test results on local filesystem in binary format',
        default: false
      },
      'save-as-json': {
        type: 'boolean',
        desc: 'Save a copy of test results on local filesystem in JSON format',
        default: false
      },
      overwrite: {
        type: 'boolean',
        desc: 'Overwrite result directory for testcase if it already exists',
        default: false
      },
      'output-directory': {
        type: 'string',
        desc: 'Path to a local directory to store result files',
        default: './results'
      },
      // 'log-level': {
      //   type: 'string',
      //   desc: 'Level of detail with which events are logged',
      //   choices: ['debug', 'info', 'warn'],
      //   default: 'info'
      // },
      offline: {
        type: 'string',
        desc: 'Disables all communications with the Touca server',
        default: false
      }
    }).argv;
  return {
    api_key: argv['api-key'],
    api_url: argv['api-url'],
    version: argv['revision'],
    team: argv['team'],
    suite: argv['suite'],
    file: argv['config-file'],
    offline: [undefined, true].includes(argv['offline']),
    save_json: argv['save-as-json'],
    save_binary: argv['save-as-binary'],
    output_directory: argv['output-directory'],
    // log_level: argv['log-level'] as 'debug' | 'info' | 'warn',
    overwrite: argv['overwrite'],
    testcases: (argv['testcase'] || []).map(String),
    testcase_file: argv['testcase-file'] as string
  };
}

/**
 *
 */
export class Runner {
  private _workflows: Record<string, (testcase: string) => void> = {};

  /**
   *
   */
  constructor(private readonly _client: NodeClient) {}

  /**
   *
   */
  public async add_workflow(
    name: string,
    workflow: (testcase: string) => void
  ): Promise<void> {
    this._workflows[name] = workflow;
  }

  /**
   *
   */
  public async run_workflows(): Promise<void> {
    try {
      await this._run_workflows(process.argv);
    } catch (error) {
      process.stderr.write(
        util.format(
          'Touca encountered an error when executing this test:\n%s\n',
          error.message
        )
      );
      process.exit(1);
    }
  }

  /**
   *
   */
  private async _run_workflows(args: string[]): Promise<void> {
    if (this._workflows === {}) {
      throw new ToucaError(ToucaErrorCode.MissingWorkflow);
    }
    const options = _parse_cli_options(args);
    await this._initialize(options);
    process.stdout.write(
      `\nTouca Test Framework\nSuite: ${options.suite}\nRevision: ${options.version}\n\n`
    );

    const offline = options.offline || !options.api_key || !options.api_url;
    const timer = new Timer();
    const stats = new Statistics();
    timer.tic('__workflow__');

    for (const [index, testcase] of options.testcases.entries()) {
      const testcase_directory = path.join(
        options.output_directory,
        options.suite as string,
        options.version as string,
        testcase
      );

      if (!options.overwrite && this._skip(options, testcase)) {
        process.stdout.write(
          util.format(
            ' (%d of %d) %s (skip)\n',
            index + 1,
            options.testcases.length,
            testcase
          )
        );
        stats.inc('skip');
        continue;
      }

      this._client.declare_testcase(testcase);
      timer.tic(testcase);

      const errors = [];
      try {
        for (const workflow_name in this._workflows) {
          await this._workflows[workflow_name](testcase);
        }
      } catch (error) {
        errors.push('message' in error ? error.message : 'unknown error');
      }

      timer.toc(testcase);
      stats.inc(errors.length === 0 ? 'pass' : 'fail');

      if (errors.length === 0 && options.save_binary) {
        const filepath = path.join(testcase_directory, 'touca.bin');
        await this._client.save_binary(filepath, [testcase]);
      }
      if (errors.length === 0 && options.save_json) {
        const filepath = path.join(testcase_directory, 'touca.json');
        await this._client.save_json(filepath, [testcase]);
      }
      if (errors.length === 0 && !offline) {
        await this._client.post();
      }

      process.stdout.write(
        util.format(
          ' (%d of %d) %s (%s, %d ms)\n',
          index + 1,
          options.testcases.length,
          testcase,
          errors.length === 0 ? 'pass' : 'fail',
          timer.count(testcase)
        )
      );

      this._client.forget_testcase(testcase);
    }

    timer.toc('__workflow__');
    process.stdout.write(
      util.format(
        '\nProcessed %d of %d test cases.\nTest completed in %d ms\n\n',
        stats.count('pass'),
        options.testcases.length,
        timer.count('__workflow__')
      )
    );

    if (!offline) {
      await this._client.seal();
    }
  }

  private async _initialize(options: RunnerOptions): Promise<void> {
    // Let the lower-level library consolidate the provided config options
    // including applying environment variables and processing long-format
    // api_url.
    update_options(options, options);

    // Check that team, suite and version are provided.
    const missing = (
      ['team', 'suite', 'version'] as (keyof RunnerOptions)[]
    ).filter((v) => options[v] === undefined);
    if (missing.length !== 0) {
      throw new ToucaError(ToucaErrorCode.MissingSlugs, [
        missing.map((v) => `"${v}"`).join(', ')
      ]);
    }

    // Check that testcase file exists
    if (options.testcase_file && !fs.existsSync(options.testcase_file)) {
      throw new ToucaError(ToucaErrorCode.NoCaseMissingFile, [
        options.testcase_file
      ]);
    }

    // Create directory to write logs and test results into
    const output_dir = path.join(
      options.output_directory,
      options.suite as string,
      options.version as string
    );
    if (!fs.existsSync(output_dir)) {
      fs.mkdirSync(output_dir, { recursive: true });
    }

    // Configure the lower-level Touca library
    if (!(await this._client.configure(options))) {
      throw new Error(this._client.configuration_error());
    }

    // Update list of test cases
    await this._update_testcase_list(options);
  }

  /**
   * Use provided config options to find the final list of test cases to use
   * for running the workflows. The following implementation assumes options
   * `--testcases` and `--testcase-file` are mutually exclusive.
   */
  private async _update_testcase_list(options: RunnerOptions): Promise<void> {
    if (options.testcases.length !== 0) {
      return;
    }
    if (options.testcase_file) {
      const content = fs.readFileSync(options.testcase_file, {
        encoding: 'utf-8'
      });
      options.testcases = content
        .split('\n')
        .filter((v) => v.length !== 0 && !v.startsWith('#'));
      return;
    }
    if (
      options.offline ||
      ['api_key', 'api_url'].some((v) => !(v in options))
    ) {
      throw new ToucaError(ToucaErrorCode.NoCaseMissingRemote);
    }
    options.testcases = await this._client.get_testcases();
    if (options.testcases.length === 0) {
      throw new ToucaError(ToucaErrorCode.NoCaseEmptyRemote);
    }
  }

  /**
   *
   */
  private _skip(options: RunnerOptions, testcase: string): boolean {
    const testcase_directory = path.join(
      options.output_directory,
      options.suite as string,
      options.version as string,
      testcase
    );
    if (options.save_binary) {
      return fs.existsSync(path.join(testcase_directory, 'touca.bin'));
    }
    if (options.save_json) {
      return fs.existsSync(path.join(testcase_directory, 'touca.json'));
    }
    return false;
  }
}
