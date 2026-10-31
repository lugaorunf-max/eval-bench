// Benchmarks use the confirmed prompt verbatim. Internal editorial/tool jobs retain
// their delivery and tool-safety protocol; those are not user-authored test cases.
export const internalTask = task => ['writing','media'].includes(task.case.id);
export const taskPrompt = task => internalTask(task) ? [task.case.prompt,task.case.instructions].filter(Boolean).join('\n\n') : task.case.prompt;
export const executionTask = task => internalTask(task) ? task : {...task,case:{...task.case,instructions:''}};
