import { debug as rawDebug } from 'debug';
import { TaskRunStatus, ValueMap } from '../types';
import { ResolverParamInfoTransform, ResolverParamInfoValue, TaskSpec } from './specs';
import { ValueQueueManager } from './value-queue-manager';
const debug = rawDebug('flowed:flow');
// tslint:disable-next-line:no-var-requires
const ST = require('flowed-st');

export class Task {
  public runStatus!: TaskRunStatus;

  public constructor(public code: string, public spec: TaskSpec) {
    this.parseSpec();
  }

  public getResolverName() {
    return (this.spec.resolver ?? { name: 'flowed::Noop' }).name;
  }

  public getSerializableState() {
    const result = JSON.parse(JSON.stringify(this.runStatus));
    result.solvedReqs = this.runStatus.solvedReqs.toSerializable();
    return result;
  }

  public setSerializableState(runStatus: any) {
    this.runStatus = JSON.parse(JSON.stringify(runStatus));
    this.runStatus.solvedReqs = ValueQueueManager.fromSerializable(runStatus.solvedReqs);
  }

  public resetRunStatus() {
    const reqs = [...(this.spec.requires ?? [])];

    this.runStatus = {
      solvedReqs: new ValueQueueManager(reqs),
      solvedResults: {},
    };
  }

  public isReadyToRun() {
    return this.runStatus.solvedReqs.allHaveContent();
  }

  public getResults(): { [name: string]: any } {
    return this.runStatus.solvedResults;
  }

  public supplyReq(reqName: string, value: any) {
    const reqIndex = (this.spec.requires ?? []).indexOf(reqName);
    if (reqIndex === -1) {
      // This can only happen if supplyReq is called manually by the user. The flow will never call with an invalid reqName.
      throw new Error(`Requirement '${reqName}' for task '${this.code}' is not valid.`);
    }

    this.runStatus.solvedReqs.push(reqName, value);
  }

  public supplyReqs(reqsMap: ValueMap) {
    for (const [reqName, req] of Object.entries(reqsMap)) {
      this.supplyReq(reqName, req);
    }
  }

  // @todo convert to protected
  public mapParamsForResolver(solvedReqs: ValueMap, automap: boolean, flowId: number) {
    const params: ValueMap = {};

    let resolverParams = (this.spec.resolver ?? { name: 'flowed::Noop' }).params ?? {};

    if (automap) {
      const requires = this.spec.requires ?? [];
      // When `Object.fromEntries()` is available in ES, use it instead of the following solution
      // @todo Add test with requires = []
      const automappedParams = requires.map(req => ({ [req]: req })).reduce((accum, peer) => Object.assign(accum, peer), {});
      debug(`[${flowId}]   🛈 Automapped resolver params in task '${this.code}':`, automappedParams);
      resolverParams = Object.assign(automappedParams, resolverParams);
    }

    let paramValue;
    for (const [resolverParamName, paramSolvingInfo] of Object.entries(resolverParams)) {
      // @todo Add test to check the case when a loop round does not set anything and make sure next value is undefined by default
      // Added to make sure default value is undefined
      paramValue = undefined;

      // If it is string, it is a task param name
      if (typeof paramSolvingInfo === 'string') {
        const taskParamName = paramSolvingInfo;
        paramValue = solvedReqs[taskParamName];
      }

      // If it is an object, expect the format { [value: <some value>], [transform: <some template>] }
      else {
        // Implicit case: if (typeof paramSolvingInfo === 'object' && paramSolvingInfo !== null)
        // Direct value pre-processor
        if (paramSolvingInfo.hasOwnProperty('value')) {
          paramValue = (paramSolvingInfo as ResolverParamInfoValue).value;
        }

        // Template transform pre-processor
        else {
          // Implicit case: if (paramSolvingInfo.hasOwnProperty('transform'))
          const template = (paramSolvingInfo as ResolverParamInfoTransform).transform;
          paramValue = ST.select(solvedReqs)
            .transformWith(template)
            .root();
        }
      }

      params[resolverParamName] = paramValue;
    }

    return params;
  }

  // @todo convert to protected
  public mapResultsFromResolver(solvedResults: ValueMap, automap: boolean, flowId: number) {
    if (typeof solvedResults !== 'object') {
      throw new Error(
        `Expected resolver for task '${
          this.code
        }' to return an object or Promise that resolves to object. Returned value is of type '${typeof solvedResults}'.`,
      );
    }

    const results: ValueMap = {};

    let resolverResults = (this.spec.resolver ?? { name: 'flowed::Noop' }).results ?? {};

    if (automap) {
      const provides = this.spec.provides ?? [];
      // When `Object.fromEntries()` is available in ES, use it instead of the following solution
      // @todo Add test with provides = []
      const automappedResults = provides.map(prov => ({ [prov]: prov })).reduce((accum, peer) => Object.assign(accum, peer), {});
      debug(`[${flowId}]   🛈 Automapped resolver results in task '${this.code}':`, automappedResults);
      resolverResults = Object.assign(automappedResults, resolverResults);
    }

    for (const [resolverResultName, taskResultName] of Object.entries(resolverResults)) {
      if (solvedResults.hasOwnProperty(resolverResultName)) {
        results[taskResultName] = solvedResults[resolverResultName];
      }
    }

    return results;
  }

  protected parseSpec() {
    this.resetRunStatus();
  }
}
