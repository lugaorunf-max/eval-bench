export interface AgentInstallation {id:string;name:string;path:string;program:string;args:string[];source:string}
export const AGENT_TYPES: {id:string;name:string;commands:string[];apps:string[];bundles:string[]}[];
export function findAgent(id:string,options?:{env?:Record<string,string|undefined>;platform?:string;home?:string;exists?:(file:string)=>Promise<boolean>}):Promise<AgentInstallation|null>;
export function capture(program:string,args:string[],options?:{env?:Record<string,string|undefined>;timeout?:number}):Promise<string>;
export function rpcClient(installation:AgentInstallation,options?:{cwd?:string;timeout?:number;experimentalApi?:boolean;onServerRequest?:(method:string,params:any)=>Promise<any>}):{request:(method:string,params?:unknown)=>Promise<any>;notify:(method:string,params?:unknown)=>void;on:(f:(message:any)=>void)=>()=>void;initialize:()=>Promise<any>;close:()=>void};
export function normalizeUsage(raw:unknown):import('../packages/contracts/index').Usage;
export function usageDifference(total:unknown,baseline:unknown):import('../packages/contracts/index').Usage;
export const ZERO_TOKEN_TOTAL:Record<string,number>;
export function readNativeThread(threadId:string,installation:AgentInstallation):Promise<{thread:any;turns:any[]}>;
