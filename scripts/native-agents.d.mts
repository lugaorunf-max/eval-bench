import type {AgentInstallation} from './agent-runtime.mjs';
import type {AgentModel,Profile} from '../packages/contracts/index';
export const SESSION_PROFILES:Record<string,string>;
export function executionHealth(agentId:string):Promise<{model:string;issue:'authentication'|'balance'|'execution'|'model_unavailable'|null;at:string;models?:Record<string,{issue:string|null;at:string}>}|null>;
export function sessionAgent(model:Profile&{baseProfileId?:string}):string|null;
export function lineRpc(installation:AgentInstallation,args:string[],options?:{cwd?:string;env?:Record<string,string>;timeout?:number}):any;
export function acpClient(installation:AgentInstallation,options?:{cwd?:string;timeout?:number}):any;
export const ACP_INIT:Record<string,unknown>;
export function acpModels(response:any):AgentModel[];
export function parseNativeUsage(text:string):{inputTokens:number;outputTokens:number;cachedInputTokens:number|null}|null;
export function probeAcpAgent(installation:AgentInstallation,directory:string):Promise<{version?:string;models:AgentModel[]}>;
export function workbuddyModels(installation:AgentInstallation):Promise<AgentModel[]>;
export function probeWorkbuddyAgent(installation:AgentInstallation):Promise<{models:AgentModel[];hasAccount:boolean}>;
export function runAcpSession(task:any,prompt:string,agentId:string):Promise<string>;
export function runWorkbuddySession(task:any,prompt:string):Promise<string>;

export function workbuddyEnvironment(installation: {path?:string}): NodeJS.ProcessEnv;
