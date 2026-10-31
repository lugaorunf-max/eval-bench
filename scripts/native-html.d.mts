export const HTML_DELIVERY:string;
export function extractNativeHtml(text:string):string;
export function saveNativeHtml(task:{case:{executionMode:string};outputDirectory:string},text:string):Promise<void>;
