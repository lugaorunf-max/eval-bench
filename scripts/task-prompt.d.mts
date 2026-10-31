export function internalTask(task:{case:{id:string}}):boolean;
export function taskPrompt(task:{case:{id:string;prompt:string;instructions?:string}}):string;
export function executionTask<T extends {case:{id:string;instructions?:string}}>(task:T):T;
